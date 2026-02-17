/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1312009135")

  // add field
  collection.fields.addAt(1, new Field({
    "cascadeDelete": true,
    "collectionId": "pbc_jobs",
    "hidden": false,
    "id": "relation4225294584",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "job",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(2, new Field({
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
      "quoted",
      "rfqReceived",
      "rfqSent",
      "pod",
      "waitingForPayment",
      "projectCompleted"
    ]
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1312009135")

  // remove field
  collection.fields.removeById("relation4225294584")

  // remove field
  collection.fields.removeById("select2063623452")

  return app.save(collection)
})
