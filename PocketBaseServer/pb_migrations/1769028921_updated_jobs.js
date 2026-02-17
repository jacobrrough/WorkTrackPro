/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // update field
  collection.fields.addAt(10, new Field({
    "hidden": false,
    "id": "select2063623452",
    "maxSelect": 1,
    "name": "status",
    "presentable": false,
    "required": false,
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
      "projectCompleted",
      "waitingForPayment"
    ]
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // update field
  collection.fields.addAt(10, new Field({
    "hidden": false,
    "id": "select2063623452",
    "maxSelect": 1,
    "name": "status",
    "presentable": false,
    "required": false,
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
      "waitinForPayment",
      "projectCompleted"
    ]
  }))

  return app.save(collection)
})
