'use strict';
var config = {
  dispatcher: {
    host: "localhost",
    port: 5907,
    secret: "yourjudgestring"
  },
  logPath: "logs/",
  cookiePath: "cookies",
  users: [
    {
      oj: "A2OJ",
      username: "bnutest",
      password: "bnutest",
      timeout: 120
    }
  ]
};

module.exports = config;