// Stand-in for a job queue such as BullMQ: add() enqueues, Worker runs jobs with retries.
export class Queue {
  constructor(name) { this.name = name; }
  async add(jobName, data) {}
}
export class Worker {
  constructor(queueName, handler, options = {}) { Object.assign(this, { queueName, handler, options }); }
}
