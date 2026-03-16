module.exports = {
  apps: [
    {
      name: 'paperweight',
      script: './src/index.js',
      max_memory_restart: '400M',
      restart_delay: 3000,
      log_file: './logs/combined.log',
      error_file: './logs/error.log',
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
