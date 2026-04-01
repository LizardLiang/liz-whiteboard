export default {
  apps: [
    {
      name: 'liz-whiteboard',
      script: '.output/server/index.mjs',
      interpreter: 'bun',
      instances: 1,
      exec_mode: 'fork',
      env_file: '.env.local',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Restart policy
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 3000,
      max_restarts: 10,
      // Logs
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
}
