const { Queue, Worker } = require('bullmq');
const connection = { host: process.env.REDIS_HOST || 'localhost', port: 6379 };

const emailQueue = new Queue('email', { connection });

async function sendReceipt(orderId) {
  const response = await fetch('https://api.mailprovider.example/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ template: 'receipt', orderId }),
  });
  if (!response.ok) {
    console.log('email failed', orderId);
  }
}

if (require.main === module) {
  new Worker('email', async (job) => sendReceipt(job.data.orderId), { connection });
}

module.exports = { emailQueue, sendReceipt };
