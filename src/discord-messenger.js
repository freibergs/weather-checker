import https from 'https';

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
        
        const hourlyData = this.aggregateWindWarnings(warnings);
        const messageText = this.formatWindMessage(hourlyData);
        
        if (!messageText) return [];
        
        return this.config.windUserIds.map(userId => ({
            discordid: userId,
            message: messageText
        }));
    }
    
    aggregatePrecipitationWarnings(warnings) {
        const hourlyData = [];
        warnings.forEach(warning => {
            const precipValue = typeof warning.precipitation === 'object' && warning.precipitation !== null ? warning.precipitation.value : warning.precipitation;
            if (precipValue && precipValue >= this.config.precipitationThreshold) {
                const time = new Date(warning.time);
                const timeStr = time.toLocaleTimeString('lv-LV', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Europe/Riga'
                });
                
                const precipData = warning.precipitation;
                const formatText = typeof precipData === 'object' && precipData.minvalue !== null && precipData.minvalue !== precipData.maxvalue
                    ? `${precipData.minvalue.toFixed(1)} - ${precipData.maxvalue.toFixed(1)} mm`
                    : `${precipValue.toFixed(1)} mm`;
                
                hourlyData.push({
                    date: warning.date,
                    time: timeStr,
                    precipitation: precipValue,
                    formatText: formatText
                });
            }
        });
        return hourlyData;
    }
    
    aggregateWindWarnings(warnings) {
        const hourlyData = [];
        const dailyWindOnlyData = {};
        
        warnings.forEach(warning => {
            const hasStrongGust = warning.windGust && warning.windGust >= this.config.windGustThreshold;
            const hasStrongWind = !warning.windGust && warning.windSpeed && warning.windSpeed >= this.config.windSpeedThreshold;
            
            if (hasStrongGust) {
                const time = new Date(warning.time);
                const timeStr = time.toLocaleTimeString('lv-LV', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Europe/Riga'
                });
                
                hourlyData.push({
                    date: warning.date,
                    time: timeStr,
                    windSpeed: warning.windSpeed || 0,
                    windGust: warning.windGust || 0,
                    hasStrongGust: true,
                    hasStrongWind: false
                });
            } else if (hasStrongWind) {
                if (!dailyWindOnlyData[warning.date] || warning.windSpeed > dailyWindOnlyData[warning.date].windSpeed) {
                    dailyWindOnlyData[warning.date] = {
                        date: warning.date,
                        windSpeed: warning.windSpeed,
                        windGust: 0,
                        hasStrongGust: false,
                        hasStrongWind: true
                    };
                }
            }
        });
        
        Object.values(dailyWindOnlyData).forEach(data => {
            hourlyData.push(data);
        });
        
        return hourlyData.sort((a, b) => a.date.localeCompare(b.date));
    }
    
    formatPrecipitationMessage(hourlyData) {
        if (hourlyData.length === 0) return null;
        
        const hourlyMessages = [];
        let currentDate = null;
        
        hourlyData.forEach(data => {
            if (currentDate !== null && currentDate !== data.date) {
                hourlyMessages.push("");
            }
            
            hourlyMessages.push(`${data.date} – ${data.time} – ${data.formatText}`);
            currentDate = data.date;
        });
        
        return hourlyMessages.length > 0 ? "⚠️ Gaidāmi nokrišņi:\n" + hourlyMessages.join("\n") : null;
    }
    
    formatWindMessage(hourlyData) {
        if (hourlyData.length === 0) return null;
        
        const hourlyMessages = [];
        let currentDate = null;
        
        hourlyData.forEach(data => {
            if (currentDate !== null && currentDate !== data.date) {
                hourlyMessages.push("");
            }
            
            let windInfo = "";
            if (data.hasStrongGust) {
                windInfo = `${data.windSpeed.toFixed(1)} (${data.windGust.toFixed(1)}) – vējš (brāzmās) m/s`;
            } else if (data.hasStrongWind) {
                windInfo = `${data.windSpeed.toFixed(1)} – vējš m/s`;
            }
            
            const timeStr = data.time ? ` – ${data.time}` : '';
            hourlyMessages.push(`${data.date}${timeStr} – ${windInfo}`);
            currentDate = data.date;
        });
        
        return "⚠️ Gaidāms stiprs vējš:\n" + hourlyMessages.join("\n");
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

export default DiscordMessenger;