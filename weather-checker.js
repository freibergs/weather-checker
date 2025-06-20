#!/usr/bin/env node

require('dotenv').config();
const https = require('https');
const { DOMParser } = require('xmldom');
const fs = require('fs');
const path = require('path');

class WeatherChecker {
    constructor() {
        this.latitude = process.env.LATITUDE;
        this.longitude = process.env.LONGITUDE;
        this.apiUrl = `https://api.met.no/weatherapi/locationforecast/2.0/classic?lat=${this.latitude}&lon=${this.longitude}`;
        this.windGustThreshold = parseFloat(process.env.WIND_GUST_THRESHOLD);
        this.precipitationThreshold = parseFloat(process.env.PRECIPITATION_THRESHOLD);
        
        // Precipitation notifications
        this.precipitationUserIds = process.env.PRECIPITATION_USER_IDS ? 
            process.env.PRECIPITATION_USER_IDS.split(',').map(id => id.trim()) : [];
        this.precipitationDaysAhead = parseInt(process.env.PRECIPITATION_DAYS_AHEAD);
        
        // Wind gust notifications
        this.windUserIds = process.env.WIND_USER_IDS ? 
            process.env.WIND_USER_IDS.split(',').map(id => id.trim()) : [];
        this.windDaysAhead = parseInt(process.env.WIND_DAYS_AHEAD);
        
        this.bearerToken = process.env.BEARER_TOKEN;
        this.endpointUrl = process.env.ENDPOINT_URL;
        
        // Log file setup
        this.logFile = path.join(__dirname, 'weather-checker.log');
        this.logOutput = [];
    }
    
    log(message) {
        const timestamp = new Date().toLocaleString('lv-LV', { 
            timeZone: 'Europe/Riga',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        const logEntry = `[${timestamp}] ${message}`;
        this.logOutput.push(logEntry);
        console.log(message);
    }
    
    saveLog() {
        const logContent = this.logOutput.join('\n') + '\n';
        
        try {
            // Add separator for new run
            const separator = '\n' + '='.repeat(80) + '\n';
            const finalContent = separator + logContent;
            
            fs.appendFileSync(this.logFile, finalContent);
        } catch (error) {
            console.error('Kļūda rakstot log failu:', error.message);
        }
    }

    async fetchWeatherData() {
        return new Promise((resolve, reject) => {
            const options = {
                headers: {
                    'User-Agent': 'WeatherChecker/1.0 (Weather monitoring script)'
                }
            };

            https.get(this.apiUrl, options, (response) => {
                let data = '';
                
                response.on('data', (chunk) => {
                    data += chunk;
                });
                
                response.on('end', () => {
                    if (response.statusCode === 200) {
                        resolve(data);
                    } else {
                        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    }
                });
            }).on('error', (error) => {
                reject(error);
            });
        });
    }

    parseWeatherData(xmlData, maxDaysAhead) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlData, 'text/xml');
        
        const timeElements = doc.getElementsByTagName('time');
        const weatherData = [];
        
        for (let i = 0; i < timeElements.length; i++) {
            const timeElement = timeElements[i];
            const fromTime = timeElement.getAttribute('from');
            const toTime = timeElement.getAttribute('to');
            
            if (!fromTime || !toTime) continue;
            
            const fromDate = new Date(fromTime);
            const toDate = new Date(toTime);
            const now = new Date();
            
            // Only include future dates (exclude today)
            const todayDateStr = now.toISOString().split('T')[0];
            const fromDateStr = fromDate.toISOString().split('T')[0];
            
            // Skip today's data - only future dates
            if (fromDateStr === todayDateStr) continue;
            
            const maxDate = new Date(now.getTime() + (maxDaysAhead * 24 * 60 * 60 * 1000));
            if (fromDate > maxDate) continue;
            
            const locationElement = timeElement.getElementsByTagName('location')[0];
            if (!locationElement) continue;
            
            const dataPoint = {
                date: fromDate.toISOString().split('T')[0],
                time: fromTime,
                windGust: null,
                precipitation: null
            };
            
            const windGustElements = locationElement.getElementsByTagName('windGust');
            for (let j = 0; j < windGustElements.length; j++) {
                const element = windGustElements[j];
                if (element.getAttribute('id') === 'ff_gust') {
                    dataPoint.windGust = parseFloat(element.getAttribute('mps'));
                    break;
                }
            }
            
            const precipitationElements = locationElement.getElementsByTagName('precipitation');
            if (precipitationElements.length > 0) {
                dataPoint.precipitation = parseFloat(precipitationElements[0].getAttribute('value'));
            }
            
            if (dataPoint.windGust !== null || dataPoint.precipitation !== null) {
                weatherData.push(dataPoint);
            }
        }
        
        return weatherData;
    }

    checkWeatherWarnings(weatherData, type = 'both') {
        const warnings = [];
        const warningDays = new Set();
        
        for (const data of weatherData) {
            const hasStrongWind = data.windGust && data.windGust > this.windGustThreshold;
            const hasHeavyRain = data.precipitation && data.precipitation > this.precipitationThreshold;
            
            let shouldInclude = false;
            if (type === 'wind' && hasStrongWind) shouldInclude = true;
            if (type === 'precipitation' && hasHeavyRain) shouldInclude = true;
            if (type === 'both' && (hasStrongWind || hasHeavyRain)) shouldInclude = true;
            
            if (shouldInclude) {
                const warning = {
                    date: data.date,
                    time: data.time,
                    windGust: data.windGust,
                    precipitation: data.precipitation,
                    reasons: []
                };
                
                if (hasStrongWind) {
                    warning.reasons.push(`Stiprs vējš: ${data.windGust} m/s (brāzmas)`);
                }
                
                if (hasHeavyRain) {
                    warning.reasons.push(`Nokrišņi: ${data.precipitation} mm`);
                }
                
                warnings.push(warning);
                warningDays.add(data.date);
            }
        }
        
        return { warnings, warningDays: Array.from(warningDays) };
    }

    generateDiscordMessages(precipitationWarnings, windWarnings) {
        const messages = [];
        
        // Generate precipitation messages
        if (precipitationWarnings.length > 0 && this.precipitationUserIds.length > 0) {
            const dayData = {};
            precipitationWarnings.forEach(warning => {
                if (!dayData[warning.date]) {
                    dayData[warning.date] = { totalPrecipitation: 0 };
                }
                if (warning.precipitation && warning.precipitation > this.precipitationThreshold) {
                    dayData[warning.date].totalPrecipitation += warning.precipitation;
                }
            });

            let messageText = "⚠️ Gaidāmi nokrišņi:\n";
            const daysWithData = Object.keys(dayData).sort();
            const dayMessages = [];
            
            daysWithData.forEach(date => {
                const data = dayData[date];
                if (data.totalPrecipitation > 0) {
                    dayMessages.push(`${date} – nokrišņi ${data.totalPrecipitation.toFixed(1)} mm`);
                }
            });
            
            if (dayMessages.length > 0) {
                messageText += dayMessages.join("\n");
                
                this.precipitationUserIds.forEach(userId => {
                    messages.push({
                        discordid: userId,
                        message: messageText
                    });
                });
            }
        }
        
        // Generate wind messages
        if (windWarnings.length > 0 && this.windUserIds.length > 0) {
            const dayData = {};
            windWarnings.forEach(warning => {
                if (!dayData[warning.date]) {
                    dayData[warning.date] = { maxWind: 0 };
                }
                if (warning.windGust && warning.windGust > this.windGustThreshold) {
                    dayData[warning.date].maxWind = Math.max(dayData[warning.date].maxWind, warning.windGust);
                }
            });

            let messageText = "⚠️ Gaidāmas stipras vēja brāzmas:\n";
            const daysWithData = Object.keys(dayData).sort();
            const dayMessages = [];
            
            daysWithData.forEach(date => {
                const data = dayData[date];
                if (data.maxWind > 0) {
                    dayMessages.push(`${date} – brāzmas līdz ${data.maxWind.toFixed(1)} m/s`);
                }
            });
            
            if (dayMessages.length > 0) {
                messageText += dayMessages.join("\n");
                
                this.windUserIds.forEach(userId => {
                    messages.push({
                        discordid: userId,
                        message: messageText
                    });
                });
            }
        }
        
        return messages;
    }

    async sendDiscordMessage(discordMessage) {
        if (!this.bearerToken || !this.endpointUrl) {
            console.error('❌ BEARER_TOKEN vai ENDPOINT_URL nav norādīts .env failā');
            return false;
        }

        return new Promise((resolve, reject) => {
            const url = new URL(this.endpointUrl);
            const postData = JSON.stringify(discordMessage);
            
            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.bearerToken}`,
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        console.log('✅ Discord ziņojums nosūtīts veiksmīgi');
                        resolve(true);
                    } else {
                        console.error(`❌ Kļūda sūtot ziņojumu: HTTP ${res.statusCode}`);
                        console.error('Response:', data);
                        resolve(false);
                    }
                });
            });

            req.on('error', (error) => {
                console.error('❌ Kļūda sūtot ziņojumu:', error.message);
                reject(error);
            });

            req.write(postData);
            req.end();
        });
    }

    printWeatherSummary(weatherData, title, daysAhead, type) {
        this.log(`\n📊 ${title} (${daysAhead} dienas):`);
        
        // Group by date and get max/total values per day
        const dailyData = {};
        weatherData.forEach(point => {
            if (!dailyData[point.date]) {
                dailyData[point.date] = {
                    maxWind: 0,
                    totalPrecipitation: 0,
                    windCount: 0,
                    precipCount: 0
                };
            }
            
            if (point.windGust !== null) {
                dailyData[point.date].maxWind = Math.max(dailyData[point.date].maxWind, point.windGust);
                dailyData[point.date].windCount++;
            }
            
            if (point.precipitation !== null) {
                dailyData[point.date].totalPrecipitation += point.precipitation;
                dailyData[point.date].precipCount++;
            }
        });
        
        // Sort dates and display only the relevant data type
        const sortedDates = Object.keys(dailyData).sort();
        sortedDates.forEach(date => {
            const data = dailyData[date];
            let displayStr = '';
            
            if (type === 'precipitation') {
                displayStr = data.precipCount > 0 ? `${data.totalPrecipitation.toFixed(1)} mm` : 'Nav nokrišņu datu';
            } else if (type === 'wind') {
                displayStr = data.windCount > 0 ? `${data.maxWind.toFixed(1)} m/s` : 'Nav vēja datu';
            }
            
            this.log(`  ${date}: ${displayStr}`);
        });
    }

    async run() {
        try {
            this.log(`📍 Atrašanās vieta: LAT ${this.latitude}, LON ${this.longitude}`);
            this.log(`🔧 Sliekšņi: Vējš >${this.windGustThreshold} m/s, Nokrišņi >${this.precipitationThreshold} mm`);
            this.log(`🗓️ Šodien: ${new Date().toISOString().split('T')[0]}`);
            
            const xmlData = await this.fetchWeatherData();
            
            // Parse precipitation data for precipitation days ahead
            const precipitationData = this.parseWeatherData(xmlData, this.precipitationDaysAhead);
            this.printWeatherSummary(precipitationData, 'NOKRIŠŅU DATI', this.precipitationDaysAhead, 'precipitation');
            const { warnings: precipitationWarnings } = this.checkWeatherWarnings(precipitationData, 'precipitation');
            
            // Parse wind data for wind days ahead
            const windData = this.parseWeatherData(xmlData, this.windDaysAhead);
            this.printWeatherSummary(windData, 'VĒJA DATI', this.windDaysAhead, 'wind');
            const { warnings: windWarnings } = this.checkWeatherWarnings(windData, 'wind');
            
            this.log(`\n⚠️ Brīdinājumi: ${precipitationWarnings.length} nokrišņu, ${windWarnings.length} vēja`);
            
            // Debug: show some wind warnings
            if (windWarnings.length > 0) {
                this.log('Pirmie 5 vēja brīdinājumi:');
                windWarnings.slice(0, 5).forEach((w, i) => {
                    this.log(`  ${i+1}. ${w.date} ${new Date(w.time).toLocaleTimeString('lv-LV', {hour: '2-digit', minute: '2-digit'})}: ${w.windGust} m/s`);
                });
                if (windWarnings.length > 5) this.log(`  ... un vēl ${windWarnings.length - 5}`);
            }
            
            // Generate messages for both types
            const allMessages = this.generateDiscordMessages(precipitationWarnings, windWarnings);
            
            if (allMessages.length === 0) {
                this.log('✅ Nav brīdinājumu - laikapstākļi ir piemēroti');
                this.saveLog();
                return false;
            }
            
            this.log(`\nSūta ${allMessages.length} ziņojumus:`);
            
            // Group messages by type for better display
            const precipitationMessages = allMessages.filter(m => m.message.includes('nokrišņi'));
            const windMessages = allMessages.filter(m => m.message.includes('brāzmas'));
            
            if (precipitationMessages.length > 0) {
                this.log('\n🌧️ NOKRIŠŅU ZIŅOJUMI:');
                precipitationMessages.forEach((message, index) => {
                    this.log(`\nZiņojums ${index + 1}:`);
                    this.log(JSON.stringify(message, null, 2));
                });
            }
            
            if (windMessages.length > 0) {
                this.log('\n💨 VĒJA ZIŅOJUMI:');
                windMessages.forEach((message, index) => {
                    this.log(`\nZiņojums ${index + 1}:`);
                    this.log(JSON.stringify(message, null, 2));
                });
            }
            
            this.log(`\n📤 Sūtīšanas process:`);
            let allSent = true;
            for (const message of allMessages) {
                this.log(`-> Sūtam lietotājam ${message.discordid}`);
                const sent = await this.sendDiscordMessage(message);
                if (!sent) allSent = false;
            }
            
            this.saveLog();
            return allSent;
            
        } catch (error) {
            this.log(`❌ Kļūda: ${error.message}`);
            this.saveLog();
            process.exit(1);
        }
    }
}

if (require.main === module) {
    const checker = new WeatherChecker();
    checker.run().then(hasWarnings => {
        process.exit(hasWarnings ? 1 : 0);
    });
}

module.exports = WeatherChecker;