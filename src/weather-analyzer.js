class WeatherAnalyzer {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
    }

    checkWeatherWarnings(weatherData, type = 'both') {
        const warnings = [];
        const warningDays = new Set();
        
        for (const data of weatherData) {
            const hasStrongWind = data.windGust && data.windGust >= this.config.windGustThreshold;
            const hasStrongWindSpeed = !data.windGust && data.windSpeed && data.windSpeed >= this.config.windSpeedThreshold;
            const precipValue = typeof data.precipitation === 'object' && data.precipitation !== null ? data.precipitation.value : data.precipitation;
            const hasHeavyRain = precipValue && precipValue >= this.config.precipitationThreshold;
            
            let shouldInclude = false;
            if (type === 'wind' && (hasStrongWind || hasStrongWindSpeed)) shouldInclude = true;
            if (type === 'precipitation' && hasHeavyRain) shouldInclude = true;
            if (type === 'both' && (hasStrongWind || hasStrongWindSpeed || hasHeavyRain)) shouldInclude = true;
            
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
                
                if (hasStrongWindSpeed) {
                    warning.reasons.push(`Stiprs vējš: ${data.windSpeed} m/s`);
                }
                
                if (hasHeavyRain) {
                    const precipValue = typeof data.precipitation === 'object' && data.precipitation !== null ? data.precipitation.value : data.precipitation;
                    warning.reasons.push(`Nokrišņi: ${precipValue} mm`);
                }
                
                warnings.push(warning);
                warningDays.add(data.date);
            }
        }
        
        return { warnings, warningDays: Array.from(warningDays) };
    }

    printWeatherSummary(weatherData, title, daysAhead, type) {
        this.logger.log(`\n📊 ${title} (${daysAhead} dienas):`);
        
        const dailyData = this.aggregateWeatherDataByDay(weatherData);
        const sortedDates = Object.keys(dailyData).sort();
        
        sortedDates.forEach(date => {
            const displayStr = this.formatDayData(dailyData[date], type);
            this.logger.log(`  ${date}: ${displayStr}`);
        });
    }
    
    aggregateWeatherDataByDay(weatherData) {
        const dailyData = {};
        
        weatherData.forEach(point => {
            if (!dailyData[point.date]) {
                dailyData[point.date] = {
                    maxWindGust: 0,
                    maxWindSpeed: 0,
                    maxPrecipitation: 0,
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
            if (point.windGust === null) {
                dayData.windCount++;
            }
        }
        
        if (point.precipitation !== null) {
            const precipValue = typeof point.precipitation === 'object' && point.precipitation !== null ? point.precipitation.value : point.precipitation;
            if (precipValue !== null) {
                dayData.maxPrecipitation = Math.max(dayData.maxPrecipitation || 0, precipValue);
                dayData.precipCount++;
            }
        }
    }
    
    formatDayData(data, type) {
        if (type === 'precipitation') {
            return data.precipCount > 0 
                ? `${data.maxPrecipitation.toFixed(1)} mm` 
                : 'Nav nokrišņu datu';
        }
        
        if (type === 'wind') {
            if (data.maxWindGust > 0) {
                let result = `brāzmas ${data.maxWindGust.toFixed(1)} m/s`;
                if (data.maxWindSpeed > 0) {
                    result += `, vējš ${data.maxWindSpeed.toFixed(1)} m/s`;
                }
                return result;
            } else if (data.maxWindSpeed > 0) {
                return `vējš ${data.maxWindSpeed.toFixed(1)} m/s`;
            }
            
            return 'Nav vēja datu';
        }
        
        return '';
    }
}

export default WeatherAnalyzer;