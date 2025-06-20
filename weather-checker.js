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
        
        this.precipitationUserIds = process.env.PRECIPITATION_USER_IDS ? 
            process.env.PRECIPITATION_USER_IDS.split(',').map(id => id.trim()) : [];
        this.precipitationDaysAhead = parseInt(process.env.PRECIPITATION_DAYS_AHEAD);
        
        this.windUserIds = process.env.WIND_USER_IDS ? 
            process.env.WIND_USER_IDS.split(',').map(id => id.trim()) : [];
        this.windDaysAhead = parseInt(process.env.WIND_DAYS_AHEAD);
        
        this.bearerToken = process.env.BEARER_TOKEN;
        this.endpointUrl = process.env.ENDPOINT_URL;
        
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
        
        return Array.from(timeElements)
            .map(timeElement => this.parseTimeElement(timeElement, maxDaysAhead))
            .filter(Boolean);
    }
    
    parseTimeElement(timeElement, maxDaysAhead) {
        const fromTime = timeElement.getAttribute('from');
        const toTime = timeElement.getAttribute('to');
        
        if (!fromTime || !toTime) return null;
        if (!this.isValidTimeRange(fromTime, maxDaysAhead)) return null;
        
        const locationElement = timeElement.getElementsByTagName('location')[0];
        if (!locationElement) return null;
        
        const dataPoint = {
            date: new Date(fromTime).toISOString().split('T')[0],
            time: fromTime,
            windGust: this.extractWindData(locationElement, 'windGust', 'ff_gust'),
            windSpeed: this.extractWindData(locationElement, 'windSpeed', 'ff'),
            precipitation: this.extractPrecipitationData(locationElement)
        };
        
        return (dataPoint.windGust !== null || dataPoint.windSpeed !== null || dataPoint.precipitation !== null) 
            ? dataPoint : null;
    }
    
    isValidTimeRange(fromTime, maxDaysAhead) {
        const fromDate = new Date(fromTime);
        const now = new Date();
        
        const todayDateStr = now.toISOString().split('T')[0];
        const fromDateStr = fromDate.toISOString().split('T')[0];
        if (fromDateStr === todayDateStr) return false;
        
        const maxDate = new Date(now.getTime() + (maxDaysAhead * 24 * 60 * 60 * 1000));
        return fromDate <= maxDate;
    }
    
    extractWindData(locationElement, tagName, expectedId) {
        const elements = locationElement.getElementsByTagName(tagName);
        for (let i = 0; i < elements.length; i++) {
            const element = elements[i];
            if (element.getAttribute('id') === expectedId) {
                return parseFloat(element.getAttribute('mps'));
            }
        }
        return null;
    }
    
    extractPrecipitationData(locationElement) {
        const precipitationElements = locationElement.getElementsByTagName('precipitation');
        return precipitationElements.length > 0 
            ? parseFloat(precipitationElements[0].getAttribute('value')) 
            : null;
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
                    windSpeed: data.windSpeed,
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
        
        const precipitationMessages = this.generatePrecipitationMessages(precipitationWarnings);
        const windMessages = this.generateWindMessages(windWarnings);
        
        return [...precipitationMessages, ...windMessages];
    }
    
    generatePrecipitationMessages(warnings) {
        if (warnings.length === 0 || this.precipitationUserIds.length === 0) return [];
        
        const dayData = this.aggregatePrecipitationWarnings(warnings);
        const messageText = this.formatPrecipitationMessage(dayData);
        
        if (!messageText) return [];
        
        return this.precipitationUserIds.map(userId => ({
            discordid: userId,
            message: messageText
        }));
    }
    
    generateWindMessages(warnings) {
        if (warnings.length === 0 || this.windUserIds.length === 0) return [];
        
        const dayData = this.aggregateWindWarnings(warnings);
        const messageText = this.formatWindMessage(dayData);
        
        if (!messageText) return [];
        
        return this.windUserIds.map(userId => ({
            discordid: userId,
            message: messageText
        }));
    }
    
    aggregatePrecipitationWarnings(warnings) {
        const dayData = {};
        warnings.forEach(warning => {
            if (!dayData[warning.date]) {
                dayData[warning.date] = { totalPrecipitation: 0 };
            }
            if (warning.precipitation && warning.precipitation > this.precipitationThreshold) {
                dayData[warning.date].totalPrecipitation += warning.precipitation;
            }
        });
        return dayData;
    }
    
    aggregateWindWarnings(warnings) {
        const dayData = {};
        warnings.forEach(warning => {
            if (!dayData[warning.date]) {
                dayData[warning.date] = { maxWindGust: 0, maxWindSpeed: 0 };
            }
            if (warning.windGust && warning.windGust > this.windGustThreshold) {
                dayData[warning.date].maxWindGust = Math.max(dayData[warning.date].maxWindGust, warning.windGust);
            }
            if (warning.windSpeed) {
                dayData[warning.date].maxWindSpeed = Math.max(dayData[warning.date].maxWindSpeed, warning.windSpeed);
            }
        });
        return dayData;
    }
    
    formatPrecipitationMessage(dayData) {
        const dayMessages = [];
        const sortedDates = Object.keys(dayData).sort();
        
        sortedDates.forEach(date => {
            const data = dayData[date];
            if (data.totalPrecipitation > 0) {
                dayMessages.push(`${date} – nokrišņi ${data.totalPrecipitation.toFixed(1)} mm`);
            }
        });
        
        return dayMessages.length > 0 ? "⚠️ Gaidāmi nokrišņi:\n" + dayMessages.join("\n") : null;
    }
    
    formatWindMessage(dayData) {
        const dayMessages = [];
        const sortedDates = Object.keys(dayData).sort();
        
        sortedDates.forEach(date => {
            const data = dayData[date];
            if (data.maxWindGust > 0) {
                let dayMessage = `${date} – brāzmas līdz ${data.maxWindGust.toFixed(1)} m/s`;
                if (data.maxWindSpeed > 0) {
                    dayMessage += `, vējš līdz ${data.maxWindSpeed.toFixed(1)} m/s`;
                }
                dayMessages.push(dayMessage);
            }
        });
        
        return dayMessages.length > 0 ? "⚠️ Gaidāmas stipras vēja brāzmas:\n" + dayMessages.join("\n") : null;
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
        
        const dailyData = this.aggregateWeatherDataByDay(weatherData);
        const sortedDates = Object.keys(dailyData).sort();
        
        sortedDates.forEach(date => {
            const displayStr = this.formatDayData(dailyData[date], type);
            this.log(`  ${date}: ${displayStr}`);
        });
    }
    
    aggregateWeatherDataByDay(weatherData) {
        const dailyData = {};
        
        weatherData.forEach(point => {
            if (!dailyData[point.date]) {
                dailyData[point.date] = {
                    maxWindGust: 0,
                    maxWindSpeed: 0,
                    totalPrecipitation: 0,
                    windCount: 0,
                    precipCount: 0
                };
            }
            
            this.updateDayData(dailyData[point.date], point);
        });
        
        return dailyData;
    }
    
    updateDayData(dayData, point) {
        if (point.windGust !== null) {
            dayData.maxWindGust = Math.max(dayData.maxWindGust, point.windGust);
            dayData.windCount++;
        }
        
        if (point.windSpeed !== null) {
            dayData.maxWindSpeed = Math.max(dayData.maxWindSpeed, point.windSpeed);
        }
        
        if (point.precipitation !== null) {
            dayData.totalPrecipitation += point.precipitation;
            dayData.precipCount++;
        }
    }
    
    formatDayData(data, type) {
        if (type === 'precipitation') {
            return data.precipCount > 0 
                ? `${data.totalPrecipitation.toFixed(1)} mm` 
                : 'Nav nokrišņu datu';
        }
        
        if (type === 'wind') {
            if (data.windCount === 0) return 'Nav vēja datu';
            
            let result = `brāzmas ${data.maxWindGust.toFixed(1)} m/s`;
            if (data.maxWindSpeed > 0) {
                result += `, vējš ${data.maxWindSpeed.toFixed(1)} m/s`;
            }
            return result;
        }
        
        return '';
    }

    async run() {
        try {
            this.log(`📍 Atrašanās vieta: LAT ${this.latitude}, LON ${this.longitude}`);
            this.log(`🔧 Sliekšņi: Vējš >${this.windGustThreshold} m/s, Nokrišņi >${this.precipitationThreshold} mm`);
            this.log(`🗓️ Šodien: ${new Date().toISOString().split('T')[0]}`);
            
            const xmlData = await this.fetchWeatherData();
            
            const precipitationData = this.parseWeatherData(xmlData, this.precipitationDaysAhead);
            this.printWeatherSummary(precipitationData, 'NOKRIŠŅU DATI', this.precipitationDaysAhead, 'precipitation');
            const { warnings: precipitationWarnings } = this.checkWeatherWarnings(precipitationData, 'precipitation');
            const windData = this.parseWeatherData(xmlData, this.windDaysAhead);
            this.printWeatherSummary(windData, 'VĒJA DATI', this.windDaysAhead, 'wind');
            const { warnings: windWarnings } = this.checkWeatherWarnings(windData, 'wind');
            
            this.log(`\n⚠️ Brīdinājumi: ${precipitationWarnings.length} nokrišņu, ${windWarnings.length} vēja`);
            
            if (windWarnings.length > 0) {
                this.log('Pirmie 5 vēja brīdinājumi:');
                windWarnings.slice(0, 5).forEach((w, i) => {
                    this.log(`  ${i+1}. ${w.date} ${new Date(w.time).toLocaleTimeString('lv-LV', {hour: '2-digit', minute: '2-digit'})}: ${w.windGust} m/s`);
                });
                if (windWarnings.length > 5) this.log(`  ... un vēl ${windWarnings.length - 5}`);
            }
            
            const allMessages = this.generateDiscordMessages(precipitationWarnings, windWarnings);
            
            if (allMessages.length === 0) {
                this.log('✅ Nav brīdinājumu - laikapstākļi ir piemēroti');
                this.saveLog();
                return false;
            }
            
            this.log(`\nSūta ${allMessages.length} ziņojumus:`);
            
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