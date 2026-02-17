/// pb_hooks/attachments.pb.js
/// Hooks for attachments collection - PocketBase v0.36.1

// Hook 1: Increment attachment count when attachment is added
onRecordAfterCreateRequest((e) => {
    const attachment = e.record
    const jobId = attachment.getString("job")
    
    if (jobId) {
        try {
            const job = $app.dao().findRecordById("jobs", jobId)
            const currentCount = job.getInt("attachmentCount")
            job.set("attachmentCount", currentCount + 1)
            $app.dao().saveRecord(job)
            console.log(`✅ Incremented attachment count for job ${jobId}`)
        } catch (err) {
            console.error(`❌ Failed to increment attachment count: ${err}`)
        }
    }
}, "attachments")

// Hook 2: Decrement attachment count when attachment is deleted
onRecordAfterDeleteRequest((e) => {
    const attachment = e.record
    const jobId = attachment.getString("job")
    
    if (jobId) {
        try {
            const job = $app.dao().findRecordById("jobs", jobId)
            const currentCount = job.getInt("attachmentCount")
            job.set("attachmentCount", Math.max(0, currentCount - 1))
            $app.dao().saveRecord(job)
            console.log(`✅ Decremented attachment count for job ${jobId}`)
        } catch (err) {
            console.error(`❌ Failed to decrement attachment count: ${err}`)
        }
    }
}, "attachments")
