const StatsD = require('node-statsd');

const ScreepsAPI = require('screeps-api').ScreepsAPI;

const api = new ScreepsAPI({
  protocol: 'https',
  host: 'screeps.com',
});

var token = '';

var succes = false;

const { createLogger, transports } = require('winston');
const LokiTransport = require('winston-loki');

const options = {
  transports: [
    new LokiTransport({
      host: `http://${process.env.LOKI_ADDR}:3100`,
    }),
    new transports.Console(),
  ],
};
const logger = createLogger(options);

module.exports = class ScreepsStatsd {
  constructor() {
    this.loop = this.loop.bind(this);
    this.signin = this.signin.bind(this);
    this.getMemory = this.getMemory.bind(this);
    this.report = this.report.bind(this);
  }

  async run(string) {
    await this.loop();
    await api.socket.connect();
    api.socket.subscribe('console', (event) => {
      let logs = event.data.messages.log;
      logs.forEach((log) => logger.info(log.replace(/(<([^>]+)>)/gi, '')));
    });

    return setInterval(this.loop, 15000);
  }

  loop() {
    return this.signin();
  }

  signin() {
    if (token !== '' && succes) {
      return this.getMemory();
    }
    this.client = new StatsD({
      host: process.env.GRAPHITE_PORT_8125_UDP_ADDR,
    });
    logger.debug('New login request - ' + new Date());

    return api
      .auth(process.env.SCREEPS_EMAIL, process.env.SCREEPS_PASSWORD)
      .then((x) => {
        token = x.token;
        api.token = x.token;
        return this.getMemory();
      });
  }

  getMemory() {
    succes = false;

    return api.memory.get('stats', process.env.SCREEPS_SHARD).then((x) => {
      if (!x.data) {
        return;
      }
      succes = true;
      return this.report(x.data);
    });
  }

  report(data, prefix = '') {
    var k, results, v;
    if (prefix === '') {
      logger.debug('Pushing to gauges - ' + new Date());
    }
    results = [];
    for (k in data) {
      v = data[k];
      if (typeof v === 'object') {
        results.push(this.report(v, prefix + k + '.'));
      } else {
        results.push(this.client.gauge(prefix + k, v));
      }
    }
    return results;
  }
};
