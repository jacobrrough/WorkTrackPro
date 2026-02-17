/// pb_hooks/jobs_automation_pb.js
/// Hooks for jobs collection automation - PocketBase v0.36.1

// Helper functions
function getChecklists(record) {
    try {
        const checklists = record.getString("checklists")
        if (!checklists || checklists === "") return []
        return JSON.parse(checklists)
    } catch (e) {
        return []
    }
}

function setChecklists(record, checklists) {
    record.set("checklists", JSON.stringify(checklists))
}

function addChecklist(record, name, items) {
    const checklists = getChecklists(record)
    checklists.push({
        name: name,
        items: items.map(item => ({ text: item, checked: false })),
        completed: false
    })
    setChecklists(record, checklists)
}

// SHOP FLOOR: When new job created
onRecordAfterCreateRequest((e) => {
    const record = e.record
    
    if (record.getString("boardType") === "shopFloor") {
        addChecklist(record, "Started", ["Assign to worker and move to in progress"])
        $app.dao().saveRecord(record)
    }
}, "jobs")

// When status changes to "To Be Quoted"
onRecordAfterUpdateRequest((e) => {
    const record = e.record
    const newStatus = record.getString("status")
    
    if (newStatus === "toBeQuoted") {
        const checklists = getChecklists(record)
        const hasEstimate = checklists.some(c => c.name === "Estimate")
        
        if (!hasEstimate) {
            addChecklist(record, "Estimate", [])
            record.set("description", "Add SK and part name here")
            $app.dao().saveRecord(record)
        }
    }
}, "jobs")

// When status changes to "In Progress" (Shop Floor)
onRecordAfterUpdateRequest((e) => {
    const record = e.record
    const newStatus = record.getString("status")
    
    if (newStatus === "inProgress" && record.getString("boardType") === "shopFloor") {
        const checklists = getChecklists(record)
        const hasFinished = checklists.some(c => c.name === "FINISHED")
        
        if (!hasFinished) {
            addChecklist(record, "FINISHED", ["DID YOU FINISH THE JOB?"])
            $app.dao().saveRecord(record)
        }
    }
}, "jobs")

// When status changes to "Quality Control"
onRecordAfterUpdateRequest((e) => {
    const record = e.record
    const newStatus = record.getString("status")
    
    if (newStatus === "qualityControl") {
        const checklists = getChecklists(record)
        const hasQC = checklists.some(c => c.name === "Quality Control Check")
        
        if (!hasQC) {
            addChecklist(record, "Quality Control Check", [
                "Checked by someone not apart of manufacturing",
                "Stencil",
                "add Logo"
            ])
            $app.dao().saveRecord(record)
        }
    }
}, "jobs")

// When status changes to "PO'd"
onRecordAfterUpdateRequest((e) => {
    const record = e.record
    const newStatus = record.getString("status")
    
    if (newStatus === "pod") {
        const checklists = getChecklists(record)
        const hasPO = checklists.some(c => c.name === "PO")
        
        if (!hasPO) {
            addChecklist(record, "PO", [])
            $app.dao().saveRecord(record)
        }
    }
}, "jobs")
