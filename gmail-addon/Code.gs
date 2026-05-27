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

  // Store email data in cache for the action callback.
  var cache = CacheService.getUserCache();
  cache.put('email_subject', subject, 600);
  cache.put('email_body', body.substring(0, 2000), 600);
  cache.put('email_from', from, 600);
  cache.put('email_date', date, 600);
  cache.put('email_message_id', gmailMessageId, 600);
  cache.put('email_gmail_id', messageId, 600);
  cache.put('email_attachment_count', String(rawAttachments.length), 600);

  return [buildMainCard(subject, bodyPreview, from, boards, attachmentInfo)];
}

/**
 * Builds the main sidebar Card with a single board>column dropdown and create button.
 */
function buildMainCard(subject, bodyPreview, from, boards, attachmentInfo) {
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

  // ── Single combined board + column dropdown ──────────
  // Google Apps Script Card dropdowns can't dynamically filter,
  // so we use one dropdown with "Board > Column" entries.
  var destSection = CardService.newCardSection().setHeader('Destination');

  if (boards.length === 0) {
    destSection.addWidget(
      CardService.newTextParagraph().setText(
        '<b>No boards found.</b> Check your API key and base URL in Script Properties.'
      )
    );
  } else {
    var dropdown = CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setTitle('Board > Column')
      .setFieldName('destination');

    var isFirst = true;
    for (var b = 0; b < boards.length; b++) {
      var board = boards[b];
      for (var c = 0; c < board.columns.length; c++) {
        var col = board.columns[c];
        var label = board.name + '  >  ' + col.name;
        var value = board.id + '|' + col.id;
        dropdown.addItem(label, value, isFirst);
        isFirst = false;
      }
    }
    destSection.addWidget(dropdown);
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
 * Action handler — called when the user clicks "Create Card".
 */
function onCreateCard(event) {
  var formInputs = event.commonEventObject.formInputs || {};

  // Parse the single combined destination dropdown (boardId|columnId).
  var boardId = '';
  var columnId = '';

  if (formInputs.destination && formInputs.destination.stringInputs) {
    var destValue = formInputs.destination.stringInputs.value[0] || '';
    var parts = destValue.split('|');
    if (parts.length === 2) {
      boardId = parts[0];
      columnId = parts[1];
    }
  }

  if (!boardId || !columnId) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('Please select a destination.')
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
