/**
 * Structured console logger with timestamp and coloring
 */

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m'
};

function formatTime() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

export const logger = {
  info(message, ...args) {
    console.log(`${colors.gray}[${formatTime()}]${colors.reset} ${colors.cyan}[INFO]${colors.reset} ${message}`, ...args);
  },
  success(message, ...args) {
    console.log(`${colors.gray}[${formatTime()}]${colors.reset} ${colors.green}[SUCCESS]${colors.reset} ${message}`, ...args);
  },
  warn(message, ...args) {
    console.warn(`${colors.gray}[${formatTime()}]${colors.reset} ${colors.yellow}[WARN]${colors.reset} ${message}`, ...args);
  },
  error(message, ...args) {
    console.error(`${colors.gray}[${formatTime()}]${colors.reset} ${colors.red}[ERROR]${colors.reset} ${message}`, ...args);
  },
  debug(message, ...args) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`${colors.gray}[${formatTime()}] [DEBUG] ${message}`, ...args);
    }
  }
};
