const fs = require('fs');
const path = require('path');

class Logger {
    constructor(logFileName = 'weather-checker.log') {
        this.logFile = path.join(process.cwd(), logFileName);
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
    
    clearCurrentSession() {
        this.logOutput = [];
    }
}

module.exports = Logger;