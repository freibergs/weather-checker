require('dotenv').config();

class Config {
    constructor() {
        this.latitude = process.env.LATITUDE;
        this.longitude = process.env.LONGITUDE;
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
        
        this.apiUrl = `https://api.met.no/weatherapi/locationforecast/2.0/classic?lat=${this.latitude}&lon=${this.longitude}`;
    }
    
    validate() {
        const required = ['latitude', 'longitude', 'windGustThreshold', 'precipitationThreshold'];
        const missing = required.filter(prop => !this[prop]);
        
        if (missing.length > 0) {
            throw new Error(`Trūkst nepieciešamo konfigurācijas parametru: ${missing.join(', ')}`);
        }
    }
}

module.exports = new Config();