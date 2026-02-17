/// pb_hooks/jobs.pb.js
/// Hooks for jobs collection - PocketBase v0.36.1

// Hook 1: Auto-add user to workers when job moves to inProgress
onRecordAfterUpdateRequest((e) => {
    const record = e.record
    
    // Get original record for comparison
    const oldStatus = record.originalCopy().getString("status")
    const newStatus = record.getString("status")
    
    // Get auth record from HTTP context
    const authRecord = e.httpContext.get("authRecord")
    
    // If status changed to inProgress and user is logged in
    if (oldStatus !== "inProgress" && newStatus === "inProgress" && authRecord) {
        const userId = authRecord.getId()
        const workers = record.getStringSlice("workers")
        
        // Add user to workers if not already there
        if (!workers.includes(userId)) {
            workers.push(userId)
            record.set("workers", workers)
            
            try {
                $app.dao().saveRecord(record)
                console.log(`✅ Added user ${userId} to job ${record.getId()}`)
            } catch (err) {
                console.error(`❌ Failed to add user to job: ${err}`)
            }
        }
    }
}, "jobs")

// Hook 2: Log status changes for debugging
onRecordAfterUpdateRequest((e) => {
    const record = e.record
    const oldStatus = record.originalCopy().getString("status")
    const newStatus = record.getString("status")
    
    if (oldStatus !== newStatus) {
        const jobCode = record.getString("jobCode")
        console.log(`📊 Job ${jobCode} moved: ${oldStatus} → ${newStatus}`)
    }
}, "jobs")
