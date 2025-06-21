const https = require('https');

class DiscordMessenger {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
    }

    generateDiscordMessages(precipitationWarnings, windWarnings) {
        const precipitationMessages = this.generatePrecipitationMessages(precipitationWarnings);
        const windMessages = this.generateWindMessages(windWarnings);
        
        return [...precipitationMessages, ...windMessages];
    }
    
    generatePrecipitationMessages(warnings) {
        if (warnings.length === 0 || this.config.precipitationUserIds.length === 0) return [];
        
        const dayData = this.aggregatePrecipitationWarnings(warnings);
        const messageText = this.formatPrecipitationMessage(dayData);
        
        if (!messageText) return [];
        
        return this.config.precipitationUserIds.map(userId => ({
            discordid: userId,
            message: messageText
        }));
    }
    
    generateWindMessages(warnings) {
        if (warnings.length === 0 || this.config.windUserIds.length === 0) return [];
        
        const dayData = this.aggregateWindWarnings(warnings);
        const messageText = this.formatWindMessage(dayData);
        
        if (!messageText) return [];
        
        return this.config.windUserIds.map(userId => ({
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
            if (warning.precipitation && warning.precipitation > this.config.precipitationThreshold) {
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
            if (warning.windGust && warning.windGust > this.config.windGustThreshold) {
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
        if (!this.config.bearerToken || !this.config.endpointUrl) {
            console.error('❌ BEARER_TOKEN vai ENDPOINT_URL nav norādīts .env failā');
            return false;
        }

        return new Promise((resolve, reject) => {
            const url = new URL(this.config.endpointUrl);
            const postData = JSON.stringify(discordMessage);
            
            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.bearerToken}`,
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
}

module.exports = DiscordMessenger;