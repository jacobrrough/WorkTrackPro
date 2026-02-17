/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_F2Nj6FmJGC` ON `jobs` (`po`)",
      "CREATE UNIQUE INDEX `idx_NwrFENyr54` ON `jobs` (`jobCode`)",
      "CREATE INDEX `idx_lvdkWIe4xr` ON `jobs` (`name`)",
      "CREATE INDEX `idx_SYXAdBfDfQ` ON `jobs` (`status`)"
    ]
  }, collection)

  // remove field
  collection.fields.removeById("file104153177")

  // add field
  collection.fields.addAt(5, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1843675174",
    "max": 0,
    "min": 0,
    "name": "description",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
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

  // add field
  collection.fields.addAt(11, new Field({
    "hidden": false,
    "id": "number3779989314",
    "max": null,
    "min": 0,
    "name": "attachmentCount",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(12, new Field({
    "hidden": false,
    "id": "number1057733009",
    "max": null,
    "min": 0,
    "name": "commentCount",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // update field
  collection.fields.addAt(1, new Field({
    "hidden": false,
    "id": "number1997877400",
    "max": null,
    "min": null,
    "name": "jobCode",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_F2Nj6FmJGC` ON `jobs` (`po`)",
      "CREATE UNIQUE INDEX `idx_NwrFENyr54` ON `jobs` (`code`)"
    ]
  }, collection)

  // add field
  collection.fields.addAt(9, new Field({
    "hidden": false,
    "id": "file104153177",
    "maxSelect": 1,
    "maxSize": 0,
    "mimeTypes": [],
    "name": "files",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": [],
    "type": "file"
  }))

  // remove field
  collection.fields.removeById("text1843675174")

  // remove field
  collection.fields.removeById("select2063623452")

  // remove field
  collection.fields.removeById("number3779989314")

  // remove field
  collection.fields.removeById("number1057733009")

  // update field
  collection.fields.addAt(1, new Field({
    "hidden": false,
    "id": "number1997877400",
    "max": null,
    "min": null,
    "name": "code",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
})
