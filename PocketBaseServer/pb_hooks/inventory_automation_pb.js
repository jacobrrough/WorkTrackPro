/// pb_hooks/inventory_automation_pb.js
/// Hooks for inventory collection - PocketBase v0.36.1

// When inventory record is updated
onRecordAfterUpdateRequest((e) => {
    const record = e.record
    const received = record.getInt("received")
    
    // Handle received inventory
    if (received >= 1) {
        const inStock = record.getInt("inStock")
        const available = record.getInt("available")
        const price = record.getFloat("price")
        
        const newInStock = inStock + received
        const newAvailable = available + received
        const stockValue = newInStock * price
        
        record.set("inStock", newInStock)
        record.set("available", newAvailable)
        record.set("stockValue", stockValue)
        record.set("received", 0)
        
        $app.dao().saveRecord(record)
        return
    }
    
    // Handle disposed inventory
    const disposed = record.getInt("disposed")
    if (disposed >= 1) {
        const inStock = record.getInt("inStock")
        const newAvailable = inStock - disposed
        
        record.set("available", newAvailable)
        $app.dao().saveRecord(record)
        return
    }
    
    // Check for low stock
    const available = record.getInt("available")
    if (available <= 0) {
        record.set("needsReorder", true)
        $app.dao().saveRecord(record)
    } else if (record.getBool("needsReorder") === true) {
        record.set("needsReorder", false)
        $app.dao().saveRecord(record)
    }
}, "inventory")
