# Trello export structure summary

Source: `BvwaAWq4 - administration (1).json` (single-line JSON, ~1.68M chars). Extracted via chunk/pattern reads.

---

## 1. Top-level keys (root object)

Board/metadata and arrays:

- **id**, **nodeId**, **name**, **desc**, **descData**
- **closed**, **creationMethod**, **creationMethodError**, **creationMethodLoadingStartedAt**, **dateClosed**
- **idOrganization**, **idEnterprise**
- **limits** (nested: attachments, boards, cards, checklists, checkItems, customFields, customFieldOptions, labels, lists, stickers, reactions)
- **pinned**, **starred**, **url**, **shortLink**, **shortUrl**, **subscribed**
- **prefs** (permissionLevel, voting, comments, cardCovers, background, etc.)
- **labelNames**, **powerUps**, **dateLastActivity**, **dateLastView**, **idTags**
- **datePluginDisable**, **ixUpdate**, **templateGallery**, **enterpriseOwned**, **idBoardSource**
- **premiumFeatures** (nested flags)
- **idMemberCreator**, **type**
- **actions**
- **lists** (array)
- **cards** (array)
- **customFields** (array)
- **labels** (array)
- **attachments** (array, if present)
- **checklists** (array, if present)
- **members** (array, if present)

---

## 2. Example list object (keys)

```json
{
  "id": "68f04abc74986bdcd42c2727",
  "name": "To Be Quoted",
  "closed": false,
  "color": "red",
  "idBoard": "68f049a2454e1224d2a9609f",
  "pos": 16384,
  "subscribed": false,
  "softLimit": null,
  "type": null,
  "datasource": { "filter": false },
  "creationMethod": null,
  "idOrganization": "68f048afb9cf5047f0813d29",
  "limits": { "cards": { "openPerList": {...}, "totalPerList": {...} } },
  "nodeId": "ari:cloud:trello::list/workspace/..."
}
```

**List keys:** `id`, `name`, `closed`, `color`, `idBoard`, `pos`, `subscribed`, `softLimit`, `type`, `datasource`, `creationMethod`, `idOrganization`, `limits`, `nodeId`.

---

## 3. Example card object (all keys)

From the first card in the export:

- **id**, **address**, **agent** (name, conversationId)
- **badges** (attachments, checkItems, checkItemsChecked, comments, description, due, dueComplete, start, attachmentsByType, externalSource, location, votes, maliciousAttachments, viewingMemberVoted, subscribed, lastUpdatedByAi, checkItemsEarliestDue, fogbugz)
- **checkItemStates**, **closed**, **coordinates**, **creationMethod**, **creationMethodError**, **creationMethodLoadingStartedAt**
- **dueComplete**, **dateClosed**, **dateLastActivity**, **dateCompleted**, **dateViewedByCreator**
- **desc**, **descData** (emoji), **due**, **dueReminder**, **email**
- **externalSource**, **faviconUrl**, **idBoard**, **idChecklists**, **idLabels**, **idList**, **idMemberCreator**, **idMembers**, **idMembersVoted**, **idOrganization**, **idShort**, **idAttachmentCover**
- **labels**, **limits** (attachments, checklists, stickers per card)
- **locationName**, **manualCoverAttachment**, **name**, **nodeId**, **originalDesc**, **originalName**
- **pinned**, **pos**, **recurrenceRule**, **shortLink**, **shortUrl**, **singleInstrumentationId**, **sourceEmail**, **staticMapUrl**, **start**, **subscribed**, **url**, **urlSource**, **urlSourceText**
- **cover** (idAttachment, color, size, brightness, yPosition, scaled[])
- **customFieldItems** (array, see §5)

**Mapping:** `idList` → list; `idMembers` → assignees; `due` / `start` → dates; `labels` / `idLabels` → tags; `attachments` (if on card) and `customFieldItems` for custom data.

---

## 4. Example custom field object (board-level)

From `customFields` array:

```json
{
  "id": "68f264cebf64ec9b466369e2",
  "idModel": "68f049a2454e1224d2a9609f",
  "modelType": "board",
  "fieldGroup": "3cbcf0d0674350230173d59659d4881a0392aa9a22fd22011c7d4e6a58f46fd4",
  "display": { "cardFront": false },
  "name": "ADDITIONAL STENCILING",
  "pos": 140737488355328,
  "type": "text",
  "isSuggestedField": false
}
```

Another (date):

```json
{
  "id": "68ffd24fbae6821f5a3693db",
  "idModel": "68f049a2454e1224d2a9609f",
  "modelType": "board",
  "fieldGroup": "...",
  "display": { "cardFront": true },
  "name": "ECD",
  "pos": 140737488371712,
  "type": "date",
  "isSuggestedField": false
}
```

**Custom field keys:** `id`, `idModel`, `modelType`, `fieldGroup`, `display`, `name`, `pos`, `type`, `isSuggestedField`.  
**type** in this file: `"text"` | `"date"`.

---

## 5. customFieldItems on a card – value shape

Each item references a board custom field and holds one value:

```json
{
  "id": "6938b75405cd4162861b8406",
  "value": { "date": "2025-12-15T20:00:00.000Z" },
  "idValue": null,
  "idCustomField": "68ffd24fbae6821f5a3693db",
  "idModel": "6901018bebc2d35083e33ad7",
  "modelType": "card"
}
```

**Value object by custom field type:**

- **date:** `{ "date": "2025-12-15T20:00:00.000Z" }` (ISO 8601 string)
- **text:** `{ "text": "9390" }` (string)

**customFieldItems keys:** `id`, `value`, `idValue`, `idCustomField`, `idModel`, `modelType`.  
Join to `customFields[].id` via `idCustomField` to get field `name` and `type`; then read `value.date` or `value.text` accordingly. (Other Trello types, e.g. number, list, checkbox, would use `value.number`, `value.idValue`, `value.checked` in the same way.)

---

## Mapping to your app (concise)

| Trello | Map to |
|--------|--------|
| Board **id** / **name** | Job/project id or name |
| **lists** | Statuses/columns (e.g. To Be Quoted, Quoted, Done) |
| **cards** | Jobs or tasks; **idList** = status |
| **cards.id**, **cards.name**, **cards.due**, **cards.desc** | Job id, title, due date, notes |
| **cards.idMembers** | Assignees (resolve via **members** if exported) |
| **cards.labels** / **idLabels** | Tags (resolve via **labels** for name/color) |
| **customFields** | Your custom field definitions (id, name, type) |
| **cards.customFieldItems** | Per-card custom values; match **idCustomField** → **customFields[].id**, then use **value.text** or **value.date** (or **number** / **idValue** / **checked** if present) |
| **attachments** (if present) | File refs; link by **idCard** |

No need to load the full file: stream or regex for `"lists":[`, `"cards":[`, `"customFields":[`, and `"customFieldItems":` to parse in chunks.
