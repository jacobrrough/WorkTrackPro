/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_502449797")

  // add field
  collection.fields.addAt(1, new Field({
    "cascadeDelete": true,
    "collectionId": "pbc_shifts",
    "hidden": false,
    "id": "relation2768976709",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "shift",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(2, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_users",
    "hidden": false,
    "id": "relation164200719",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "editedBy",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(3, new Field({
    "hidden": false,
    "id": "date1722581045",
    "max": "",
    "min": "",
    "name": "previousClockIn",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // add field
  collection.fields.addAt(4, new Field({
    "hidden": false,
    "id": "date1808958641",
    "max": "",
    "min": "",
    "name": "newClockIn",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // add field
  collection.fields.addAt(5, new Field({
    "hidden": false,
    "id": "date2114225443",
    "max": "",
    "min": "",
    "name": "previousClockOut",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // add field
  collection.fields.addAt(6, new Field({
    "hidden": false,
    "id": "date2497494046",
    "max": "",
    "min": "",
    "name": "newClockOut",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // add field
  collection.fields.addAt(7, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1001949196",
    "max": 0,
    "min": 0,
    "name": "reason",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(8, new Field({
    "hidden": false,
    "id": "date585729492",
    "max": "",
    "min": "",
    "name": "editTimestamp",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_502449797")

  // remove field
  collection.fields.removeById("relation2768976709")

  // remove field
  collection.fields.removeById("relation164200719")

  // remove field
  collection.fields.removeById("date1722581045")

  // remove field
  collection.fields.removeById("date1808958641")

  // remove field
  collection.fields.removeById("date2114225443")

  // remove field
  collection.fields.removeById("date2497494046")

  // remove field
  collection.fields.removeById("text1001949196")

  // remove field
  collection.fields.removeById("date585729492")

  return app.save(collection)
})
