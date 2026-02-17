/// pb_hooks/comments.pb.js
/// Hooks for comments collection - PocketBase v0.36.1

// Hook 1: Increment comment count when comment is added
onRecordAfterCreateRequest((e) => {
    const comment = e.record
    const jobId = comment.getString("job")
    
    if (jobId) {
        try {
            const job = $app.dao().findRecordById("jobs", jobId)
            const currentCount = job.getInt("commentCount")
            job.set("commentCount", currentCount + 1)
            $app.dao().saveRecord(job)
            console.log(`✅ Incremented comment count for job ${jobId}`)
        } catch (err) {
            console.error(`❌ Failed to increment comment count: ${err}`)
        }
    }
}, "comments")

// Hook 2: Decrement comment count when comment is deleted
onRecordAfterDeleteRequest((e) => {
    const comment = e.record
    const jobId = comment.getString("job")
    
    if (jobId) {
        try {
            const job = $app.dao().findRecordById("jobs", jobId)
            const currentCount = job.getInt("commentCount")
            job.set("commentCount", Math.max(0, currentCount - 1))
            $app.dao().saveRecord(job)
            console.log(`✅ Decremented comment count for job ${jobId}`)
        } catch (err) {
            console.error(`❌ Failed to decrement comment count: ${err}`)
        }
    }
}, "comments")
