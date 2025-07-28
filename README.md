# Weather Checker

Automated weather warning script that sends Discord notifications for strong wind gusts and precipitation.

## Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your configuration values in the `.env` file

3. Install dependencies:
   ```bash
   npm install
   ```

## Usage

### Manual run
```bash
node weather-checker.js
```

### Automated with cron (recommended)

For optimal monitoring, run this script as a cron job. Add to your crontab:

```bash
# Check weather every 6 hours
0 */6 * * * cd /path/to/folder && node weather-checker.js

# Or check twice daily (morning and evening)
0 6,18 * * * cd /path/to/folder && node weather-checker.js
```

The script will automatically check weather conditions and send Discord notifications when warnings are triggered. All activity is logged to `weather-checker.log`.
