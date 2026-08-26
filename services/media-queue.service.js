const queue = [];
let active = 0;
const MAX_ACTIVE = 2;
const MAX_QUEUE = 10;
const userJobs = new Map();

function enqueue(task, metadata = {}) {
    return new Promise((resolve, reject) => {
        const senderId = metadata.senderId || 'unknown';
        const currentJobs = userJobs.get(senderId) || 0;
        if (queue.length >= MAX_QUEUE) return reject(new Error('Antrean media sedang penuh. Coba lagi nanti.'));
        if (currentJobs >= 3) return reject(new Error('Batas antrean media kamu sudah mencapai 3 job.'));
        userJobs.set(senderId, currentJobs + 1);
        queue.push({ task, metadata, resolve, reject, senderId });
        drain();
    });
}
function drain() {
    while (active < MAX_ACTIVE && queue.length) {
        const job = queue.shift();
        active++;
        Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {
            const currentJobs = userJobs.get(job.senderId) || 1;
            if (currentJobs <= 1) userJobs.delete(job.senderId); else userJobs.set(job.senderId, currentJobs - 1);
            active--;
            drain();
        });
    }
}
function getStatus() { return { active, queued: queue.length, maxActive: MAX_ACTIVE }; }
module.exports = { enqueue, getStatus };
