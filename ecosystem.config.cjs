module.exports = {
  apps: [
    {
      name: "agewellri-backend",
      cwd: "C:/Rubel/age-well-ri-backend",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/server.ts",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 5173,
      },
      env_development: {
        NODE_ENV: "development",
        PORT: 5173,
      },
    },
  ],
};
