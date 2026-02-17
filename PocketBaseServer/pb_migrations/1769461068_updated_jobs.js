/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_jobs")

  // update field
  collection.fields.addAt(10, new Field({
    "hidden": false,
    "id": "select_status",
    "maxSelect": 1,
    "name": "status",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "select",
    "values": [
      "pending",
      "rush",
      "inProgress",
      "qualityControl",
      "finished",
      "delivered",
      "onHold",
      "toBeQuoted",
      "rfqReceived",
      "rfqSent",
      "pod",
      "waitingForPayment",
      "projectCompleted",
      "quoted"
    ]
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_jobs")

  // update field
  collection.fields.addAt(10, new Field({
    "hidden": false,
    "id": "select_status",
    "maxSelect": 1,
    "name": "status",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "select",
    "values": [
      "pending",
      "rush",
      "inProgress",
      "qualityControl",
      "finished",
      "delivered",
      "onHold",
      "toBeQuoted",
      "rfqReceived",
      "rfqSent",
      "pod",
      "waitingForPayment",
      "projectCompleted"
    ]
  }))

  return app.save(collection)
})
