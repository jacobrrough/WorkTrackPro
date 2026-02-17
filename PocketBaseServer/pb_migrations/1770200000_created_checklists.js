/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "name": "checklists",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false,
        "id": "job_field",
        "name": "job",
        "type": "relation",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {
          "collectionId": "pbc_jobs",
          "cascadeDelete": true,
          "minSelect": null,
          "maxSelect": 1,
          "displayFields": null
        }
      },
      {
        "system": false,
        "id": "status_field",
        "name": "status",
        "type": "select",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "maxSelect": 1,
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
        }
      },
      {
        "system": false,
        "id": "items_field",
        "name": "items",
        "type": "json",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "maxSize": 2000000
        }
      }
    ],
    "indexes": [],
    "listRule": "@request.auth.id != ''",
    "viewRule": "@request.auth.id != ''",
    "createRule": "@request.auth.isAdmin = true",
    "updateRule": "@request.auth.isAdmin = true",
    "deleteRule": "@request.auth.isAdmin = true",
    "options": {}
  })

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("checklists")
  return app.delete(collection)
})
