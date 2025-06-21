#!/usr/bin/env node

import config from './src/config.js';
import Logger from './src/logger.js';
import WeatherAPI from './src/weather-api.js';
import WeatherAnalyzer from './src/weather-analyzer.js';
import DiscordMessenger from './src/discord-messenger.js';

class WeatherChecker {
    constructor() {
        this.config = config;
        this.logger = new Logger();
        this.weatherAPI = new WeatherAPI(this.config);
        this.analyzer = new WeatherAnalyzer(this.config, this.logger);
        this.messenger = new DiscordMessenger(this.config, this.logger);
    }

    async run() {
        try {
            this.config.validate();
            
            this.logger.log(`📍 Atrašanās vieta: LAT ${this.config.latitude}, LON ${this.config.longitude}`);
            this.logger.log(`🔧 Sliekšņi: Vējš >${this.config.windGustThreshold} m/s, Nokrišņi >${this.config.precipitationThreshold} mm`);
            this.logger.log(`🗓️ Šodien: ${new Date().toISOString().split('T')[0]}`);
            
            const xmlData = await this.weatherAPI.fetchWeatherData();
            
            const precipitationData = this.weatherAPI.parseWeatherData(xmlData, this.config.precipitationDaysAhead);
            this.analyzer.printWeatherSummary(precipitationData, 'NOKRIŠŅU DATI', this.config.precipitationDaysAhead, 'precipitation');
            const { warnings: precipitationWarnings } = this.analyzer.checkWeatherWarnings(precipitationData, 'precipitation');
            
            const windData = this.weatherAPI.parseWeatherData(xmlData, this.config.windDaysAhead);
            this.analyzer.printWeatherSummary(windData, 'VĒJA DATI', this.config.windDaysAhead, 'wind');
            const { warnings: windWarnings } = this.analyzer.checkWeatherWarnings(windData, 'wind');
            
            this.logger.log(`\n⚠️ Brīdinājumi: ${precipitationWarnings.length} nokrišņu, ${windWarnings.length} vēja`);
            
            if (windWarnings.length > 0) {
                this.logger.log('Pirmie 5 vēja brīdinājumi:');
                windWarnings.slice(0, 5).forEach((w, i) => {
                    this.logger.log(`  ${i+1}. ${w.date} ${new Date(w.time).toLocaleTimeString('lv-LV', {hour: '2-digit', minute: '2-digit'})}: ${w.windGust} m/s`);
                });
                if (windWarnings.length > 5) this.logger.log(`  ... un vēl ${windWarnings.length - 5}`);
            }
            
            const allMessages = this.messenger.generateDiscordMessages(precipitationWarnings, windWarnings);
            
            if (allMessages.length === 0) {
                this.logger.log('✅ Nav brīdinājumu - laikapstākļi ir piemēroti');
                this.logger.saveLog();
                return false;
            }
            
            this.logger.log(`\nSūta ${allMessages.length} ziņojumus:`);
            
            const precipitationMessages = allMessages.filter(m => m.message.includes('nokrišņi'));
            const windMessages = allMessages.filter(m => m.message.includes('brāzmas'));
            
            if (precipitationMessages.length > 0) {
                this.logger.log('\n🌧️ NOKRIŠŅU ZIŅOJUMI:');
                precipitationMessages.forEach((message, index) => {
                    this.logger.log(`\nZiņojums ${index + 1}:`);
                    this.logger.log(JSON.stringify(message, null, 2));
                });
            }
            
            if (windMessages.length > 0) {
                this.logger.log('\n💨 VĒJA ZIŅOJUMI:');
                windMessages.forEach((message, index) => {
                    this.logger.log(`\nZiņojums ${index + 1}:`);
                    this.logger.log(JSON.stringify(message, null, 2));
                });
            }
            
            this.logger.log(`\n📤 Sūtīšanas process:`);
            let allSent = true;
            for (const message of allMessages) {
                this.logger.log(`-> Sūtam lietotājam ${message.discordid}`);
                const sent = await this.messenger.sendDiscordMessage(message);
                if (!sent) allSent = false;
            }
            
            this.logger.saveLog();
            return allSent;
            
        } catch (error) {
            this.logger.log(`❌ Kļūda: ${error.message}`);
            this.logger.saveLog();
            process.exit(1);
        }
    }
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
    const checker = new WeatherChecker();
    checker.run().then(hasWarnings => {
        process.exit(hasWarnings ? 1 : 0);
    });
}

export default WeatherChecker;