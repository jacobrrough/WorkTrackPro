/**
 * WorkTrack Card Creator — Gmail Add-on entry point.
 *
 * Triggered when a user opens any email. Builds a sidebar card that lets
 * the user select a board + column and create a kanban card from the email.
 *
 * SETUP: Set two Script Properties (File > Project settings > Script properties):
 *   API_KEY      — The value of your GMAIL_ADDON_API_KEY Netlify env var
 *   API_BASE_URL — Your Netlify site URL, e.g. https://your-app.netlify.app
 */

/**
 * Gmail contextual trigger — fires when the user opens an email.
 * Returns an array of Cards to display in the add-on sidebar.
 */
function onGmailMessage(event) {
  var messageId = event.gmail.messageId;
  var accessToken = event.gmail.accessToken;
  GmailApp.setCurrentMessageAccessToken(accessToken);

  var message = GmailApp.getMessageById(messageId);
  var subject = message.getSubject() || '(no subject)';
  var body = message.getPlainBody() || '';
  var from = message.getFrom() || '';
  var date = message.getDate() ? message.getDate().toISOString() : '';
  var gmailMessageId = message.getId();

  // Truncate body preview for the sidebar.
  var bodyPreview = body.length > 300 ? body.substring(0, 300) + '...' : body;

  // Get attachments list (name + size).
  var rawAttachments = message.getAttachments();
  var attachmentInfo = [];
  for (var i = 0; i < rawAttachments.length; i++) {
    var att = rawAttachments[i];
    var sizeKb = Math.round(att.getSize() / 1024);
    var tooLarge = att.getSize() > 5 * 1024 * 1024;
    attachmentInfo.push({
      index: i,
      name: att.getName(),
      sizeKb: sizeKb,
      tooLarge: tooLarge
    });
  }

  // Fetch boards for the dropdown.
  var boards = fetchBoards();

  // Store email data in cache for the action callbacks (board-change + create).
  var cache = CacheService.getUserCache();
  cache.put('email_subject', subject, 600);
  cache.put('email_body', body.substring(0, 2000), 600);
  cache.put('email_body_preview', bodyPreview, 600);
  cache.put('email_from', from, 600);
  cache.put('email_date', date, 600);
  cache.put('email_message_id', gmailMessageId, 600);
  cache.put('email_gmail_id', messageId, 600);
  cache.put('email_attachment_count', String(rawAttachments.length), 600);
  cache.put('email_boards', JSON.stringify(boards), 600);
  cache.put('email_attachments_info', JSON.stringify(attachmentInfo), 600);

  return [buildMainCard(subject, bodyPreview, from, boards, attachmentInfo, '', '')];
}

/**
 * Builds the main sidebar Card.
 *
 * Two-step destination selector: a Board dropdown, then a Column dropdown
 * whose options are filtered to the selected board. When the user picks a
 * different board, onBoardChanged rebuilds the card.
 *
 * @param {string} selectedBoardId  — currently-selected board id, or '' for default
 * @param {string} selectedColumnId — currently-selected column id, or '' for default
 */
function buildMainCard(subject, bodyPreview, from, boards, attachmentInfo, selectedBoardId, selectedColumnId) {
  var card = CardService.newCardBuilder();
  card.setHeader(
    CardService.newCardHeader()
      .setTitle('Create Board Card')
      .setSubtitle('From this email')
  );

  // ── Email preview section ────────────────────────────
  var emailSection = CardService.newCardSection().setHeader('Email');
  emailSection.addWidget(
    CardService.newDecoratedText()
      .setTopLabel('Subject')
      .setText(subject || '(no subject)')
  );
  emailSection.addWidget(
    CardService.newDecoratedText()
      .setTopLabel('From')
      .setText(from || '(unknown)')
  );
  if (bodyPreview) {
    emailSection.addWidget(
      CardService.newDecoratedText()
        .setTopLabel('Body preview')
        .setText(bodyPreview)
        .setWrapText(true)
    );
  }
  card.addSection(emailSection);

  // ── Two-step destination selector ────────────────────
  // First pick the board. The column dropdown is filtered to that board's
  // columns; when the user changes the board, onBoardChanged rebuilds the
  // card with the new column list.
  var destSection = CardService.newCardSection().setHeader('Destination');

  if (boards.length === 0) {
    destSection.addWidget(
      CardService.newTextParagraph().setText(
        '<b>No boards found.</b> Check your API key and base URL in Script Properties.'
      )
    );
  } else {
    // Resolve the effective board: caller's choice if still valid, else first.
    var effectiveBoardId = '';
    for (var bIdx = 0; bIdx < boards.length; bIdx++) {
      if (boards[bIdx].id === selectedBoardId) {
        effectiveBoardId = selectedBoardId;
        break;
      }
    }
    if (!effectiveBoardId) effectiveBoardId = boards[0].id;

    // Board dropdown — onChange refreshes the column list below.
    var boardChangeAction = CardService.newAction().setFunctionName('onBoardChanged');
    var boardDropdown = CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setTitle('Board')
      .setFieldName('boardId')
      .setOnChangeAction(boardChangeAction);
    for (var bAdd = 0; bAdd < boards.length; bAdd++) {
      boardDropdown.addItem(
        boards[bAdd].name,
        boards[bAdd].id,
        boards[bAdd].id === effectiveBoardId
      );
    }
    destSection.addWidget(boardDropdown);

    // Look up the active board so we can populate its columns.
    var selectedBoard = null;
    for (var bFind = 0; bFind < boards.length; bFind++) {
      if (boards[bFind].id === effectiveBoardId) {
        selectedBoard = boards[bFind];
        break;
      }
    }

    if (selectedBoard && selectedBoard.columns && selectedBoard.columns.length > 0) {
      // Default to the first column unless caller picked a valid one for this board.
      var effectiveColumnId = '';
      for (var cIdx = 0; cIdx < selectedBoard.columns.length; cIdx++) {
        if (selectedBoard.columns[cIdx].id === selectedColumnId) {
          effectiveColumnId = selectedColumnId;
          break;
        }
      }
      if (!effectiveColumnId) effectiveColumnId = selectedBoard.columns[0].id;

      var columnDropdown = CardService.newSelectionInput()
        .setType(CardService.SelectionInputType.DROPDOWN)
        .setTitle('Column')
        .setFieldName('columnId');
      for (var cAdd = 0; cAdd < selectedBoard.columns.length; cAdd++) {
        var col = selectedBoard.columns[cAdd];
        columnDropdown.addItem(col.name, col.id, col.id === effectiveColumnId);
      }
      destSection.addWidget(columnDropdown);
    }
  }

  card.addSection(destSection);

  // ── Attachments section ──────────────────────────────
  if (attachmentInfo.length > 0) {
    var attSection = CardService.newCardSection().setHeader(
      'Attachments (' + attachmentInfo.length + ')'
    );
    var checkboxGroup = CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.CHECK_BOX)
      .setTitle('Include attachments')
      .setFieldName('selectedAttachments');

    for (var a = 0; a < attachmentInfo.length; a++) {
      var info = attachmentInfo[a];
      var label = info.name + ' (' + info.sizeKb + ' KB)';
      if (info.tooLarge) {
        label += ' [TOO LARGE]';
      }
      checkboxGroup.addItem(label, String(info.index), !info.tooLarge);
    }
    attSection.addWidget(checkboxGroup);
    card.addSection(attSection);
  }

  // ── Create button ────────────────────────────────────
  if (boards.length > 0) {
    var actionSection = CardService.newCardSection();
    var createAction = CardService.newAction().setFunctionName('onCreateCard');
    actionSection.addWidget(
      CardService.newTextButton()
        .setText('Create Card')
        .setOnClickAction(createAction)
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor('#6366f1')
    );
    card.addSection(actionSection);
  }

  return card.build();
}

/**
 * Action handler — fires when the user picks a different board from the
 * board dropdown. Rebuilds the card so the column dropdown shows only that
 * board's columns. State (boards, attachmentInfo, email preview) is loaded
 * from the user cache that was populated in onGmailMessage; if the cache
 * has expired (10 min), boards are re-fetched as a fallback.
 */
function onBoardChanged(event) {
  var formInputs = (event.commonEventObject && event.commonEventObject.formInputs) || {};
  var newBoardId = '';
  if (formInputs.boardId && formInputs.boardId.stringInputs) {
    newBoardId = formInputs.boardId.stringInputs.value[0] || '';
  }

  var cache = CacheService.getUserCache();
  var subject = cache.get('email_subject') || '(no subject)';
  var bodyPreview = cache.get('email_body_preview') || '';
  var from = cache.get('email_from') || '';
  var boardsJson = cache.get('email_boards');
  var attachmentsJson = cache.get('email_attachments_info');
  var boards = boardsJson ? JSON.parse(boardsJson) : [];
  var attachmentInfo = attachmentsJson ? JSON.parse(attachmentsJson) : [];

  // Cache miss: re-fetch boards so the dropdown isn't suddenly empty.
  if (boards.length === 0) {
    boards = fetchBoards();
    cache.put('email_boards', JSON.stringify(boards), 600);
  }

  var newCard = buildMainCard(
    subject, bodyPreview, from, boards, attachmentInfo, newBoardId, ''
  );

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(newCard))
    .build();
}

/**
 * Action handler — called when the user clicks "Create Card".
 */
function onCreateCard(event) {
  var formInputs = event.commonEventObject.formInputs || {};

  // Read the two separate dropdowns wired up in buildMainCard.
  var boardId = '';
  var columnId = '';

  if (formInputs.boardId && formInputs.boardId.stringInputs) {
    boardId = formInputs.boardId.stringInputs.value[0] || '';
  }
  if (formInputs.columnId && formInputs.columnId.stringInputs) {
    columnId = formInputs.columnId.stringInputs.value[0] || '';
  }

  if (!boardId || !columnId) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('Please select a board and column.')
      )
      .build();
  }

  // Retrieve cached email data.
  var cache = CacheService.getUserCache();
  var subject = cache.get('email_subject') || '(no subject)';
  var body = cache.get('email_body') || '';
  var from = cache.get('email_from') || '';
  var date = cache.get('email_date') || '';
  var emailMessageId = cache.get('email_message_id') || '';
  var gmailId = cache.get('email_gmail_id') || '';

  // Gather selected attachments.
  var selectedIndexes = [];
  if (formInputs.selectedAttachments && formInputs.selectedAttachments.stringInputs) {
    selectedIndexes = formInputs.selectedAttachments.stringInputs.value.map(Number);
  }

  var attachmentPayloads = [];
  var attachmentError = '';
  if (selectedIndexes.length > 0 && gmailId) {
    try {
      // Use gmail.readonly scope to access the full message directly.
      var message = GmailApp.getMessageById(gmailId);
      if (message) {
        var rawAttachments = message.getAttachments();
        for (var i = 0; i < selectedIndexes.length; i++) {
          var idx = selectedIndexes[i];
          if (idx >= 0 && idx < rawAttachments.length) {
            var att = rawAttachments[idx];
            if (att.getSize() <= 5 * 1024 * 1024) {
              attachmentPayloads.push({
                filename: att.getName(),
                mimeType: att.getContentType(),
                base64Data: Utilities.base64Encode(att.getBytes())
              });
            }
          }
        }
      } else {
        attachmentError = 'Could not re-read email.';
      }
    } catch (e) {
      Logger.log('Failed to read attachments: ' + e.message);
      attachmentError = e.message;
    }
  }

  // Call the Netlify function.
  var requestBody = {
    boardId: boardId,
    columnId: columnId,
    title: subject,
    description: body,
    emailMetadata: {
      from: from,
      date: date,
      messageId: emailMessageId
    },
    attachments: attachmentPayloads
  };

  var result = createCardViaApi(requestBody);

  if (result.ok) {
    var msg = 'Card created!';
    if (result.attachmentCount > 0) {
      msg += ' (' + result.attachmentCount + ' file' + (result.attachmentCount > 1 ? 's' : '') + ' attached)';
    } else if (selectedIndexes.length > 0 && result.attachmentCount === 0) {
      msg += ' (attachments failed';
      if (attachmentError) msg += ': ' + attachmentError;
      msg += ')';
    }
    if (result.jobCode) {
      msg += ' Job #' + result.jobCode;
    }
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(msg))
      .build();
  } else {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('Failed: ' + (result.error || 'Unknown error'))
      )
      .build();
  }
}
