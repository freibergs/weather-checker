const https = require('https');
const { DOMParser } = require('xmldom');

class WeatherAPI {
    constructor(config) {
        this.config = config;
    }
    
    async fetchWeatherData() {
        return new Promise((resolve, reject) => {
            const options = {
                headers: {
                    'User-Agent': 'WeatherChecker/1.0 (Weather monitoring script)'
                }
            };

            https.get(this.config.apiUrl, options, (response) => {
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
}

module.exports = WeatherAPI;