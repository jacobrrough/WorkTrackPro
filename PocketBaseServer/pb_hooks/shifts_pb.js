/// pb_hooks/shifts.pb.js
/// Hooks for shifts collection - PocketBase v0.36.1

// Hook 1: Auto clock-out previous job when clocking into new job
onRecordBeforeCreateRequest((e) => {
    const shift = e.record
    const userId = shift.getString("user")
    const jobId = shift.getString("job")
    
    if (userId && jobId) {
        try {
            // Find any active shifts for this user (where clockOutTime is empty)
            const activeShifts = $app.dao().findRecordsByFilter(
                "shifts",
                `user = "${userId}" && clockOutTime = ""`,
                "-created",
                1
            )
            
            if (activeShifts.length > 0) {
                const activeShift = activeShifts[0]
                const now = new Date().toISOString()
                activeShift.set("clockOutTime", now)
                $app.dao().saveRecord(activeShift)
                console.log(`⏰ Auto clocked out user ${userId} from previous job`)
            }
        } catch (err) {
            console.error(`❌ Failed to auto clock-out: ${err}`)
        }
    }
}, "shifts")

// Hook 2: Add user to job's workers when they clock in
onRecordAfterCreateRequest((e) => {
    const shift = e.record
    const userId = shift.getString("user")
    const jobId = shift.getString("job")
    
    if (userId && jobId) {
        try {
            const job = $app.dao().findRecordById("jobs", jobId)
            const workers = job.getStringSlice("workers")
            
            if (!workers.includes(userId)) {
                workers.push(userId)
                job.set("workers", workers)
                $app.dao().saveRecord(job)
                console.log(`✅ Added worker ${userId} to job ${jobId}`)
            }
        } catch (err) {
            console.error(`❌ Failed to add worker to job: ${err}`)
        }
    }
}, "shifts")

// Hook 3: Remove user from job's workers when they clock out
onRecordAfterUpdateRequest((e) => {
    const shift = e.record
    const oldClockOut = shift.originalCopy().getString("clockOutTime")
    const newClockOut = shift.getString("clockOutTime")
    const userId = shift.getString("user")
    const jobId = shift.getString("job")
    
    // If user just clocked out (clockOutTime changed from empty to a value)
    if (!oldClockOut && newClockOut && userId && jobId) {
        try {
            const job = $app.dao().findRecordById("jobs", jobId)
            const workers = job.getStringSlice("workers")
            
            // Only remove if user has no other active shifts for this job
            const otherActiveShifts = $app.dao().findRecordsByFilter(
                "shifts",
                `user = "${userId}" && job = "${jobId}" && clockOutTime = ""`,
                "-created",
                1
            )
            
            if (otherActiveShifts.length === 0) {
                const updatedWorkers = workers.filter(id => id !== userId)
                job.set("workers", updatedWorkers)
                $app.dao().saveRecord(job)
                console.log(`✅ Removed worker ${userId} from job ${jobId}`)
            }
        } catch (err) {
            console.error(`❌ Failed to remove worker from job: ${err}`)
        }
    }
}, "shifts")
