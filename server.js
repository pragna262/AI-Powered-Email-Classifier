const express = require('express'); 
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());  // <-- Added middleware to parse JSON bodies

const credentials = JSON.parse(fs.readFileSync(path.join(__dirname, 'credentials.json')));
const oAuth2Client = new google.auth.OAuth2(
  credentials.installed.client_id,
  credentials.installed.client_secret,
  credentials.installed.redirect_uris[0]
);

let categorizedEmails = {
  "BVRIT IMP": [],
  BVRIT: [],
  Unstop: [],
  LinkedIn: [],
  Coding: [],
  Promotions: []
};

const importantBvrithEmailsList = [
  'jpreddy.s@bvrithyderabad.edu.in',
  'placements@bvrithyderabad.edu.in',
  'kiranmayi.t@bvrithyderabad.edu.in',
  'sandeep.g@bvrithyderabad.edu.in',
  'prof.academics@bvrithyderabad.edu.in'
].map(e => e.toLowerCase());

function extractEmailAddress(fromHeader) {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : fromHeader.toLowerCase();
}

// In-memory storage for labels
let labels = [];

app.get('/auth', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  });
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const messagesList = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 50,
      q: "is:unread"
    });

    categorizedEmails = {
      "BVRIT IMP": [],
      BVRIT: [],
      Unstop: [],
      LinkedIn: [],
      Coding: [],
      Promotions: []
    };

    if (!messagesList.data.messages) return res.redirect('/');

    let processed = 0;
    for (let message of messagesList.data.messages) {
      const msgDetails = await gmail.users.messages.get({ userId: 'me', id: message.id });
      const payload = msgDetails.data.payload;
      const headers = payload.headers;
      const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
      const from = headers.find(h => h.name === 'From')?.value || 'Unknown Sender';

      let body = '';
      if (payload.parts) {
        for (const part of payload.parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            body = Buffer.from(part.body.data, 'base64').toString('utf-8');
            break;
          }
        }
      }

      const email = { subject, from, body };
      const senderEmail = extractEmailAddress(from);

      // Check custom labels first (from stored labels)
      let matchedLabel = null;
      for (const labelObj of labels) {
        if (senderEmail === labelObj.senderEmail.toLowerCase()) {
          matchedLabel = labelObj.labelName;
          break;
        }
      }

      if (matchedLabel) {
        if (!categorizedEmails[matchedLabel]) categorizedEmails[matchedLabel] = [];
        categorizedEmails[matchedLabel].push(email);
      } else if (senderEmail.includes('unstop') || senderEmail.includes('dare2compete.news')) {
        categorizedEmails.Unstop.push(email);
      } else if (
        senderEmail.includes('linkedin.com') ||
        senderEmail.includes('messages-noreply@linkedin.com') ||
        senderEmail.includes('noreply@linkedin.com')
      ) {
        categorizedEmails.LinkedIn.push(email);
      } else if (senderEmail.endsWith('@bvrithyderabad.edu.in')) {
        if (importantBvrithEmailsList.includes(senderEmail)) {
          categorizedEmails["BVRIT IMP"].push(email);
        } else {
          categorizedEmails.BVRIT.push(email);
        }
      } else if (
        senderEmail.includes('codechef') ||
        senderEmail.includes('leetcode') ||
        senderEmail.includes('codeforces')
      ) {
        categorizedEmails.Coding.push(email);
      } else {
        categorizedEmails.Promotions.push(email);
      }

      processed++;
    }

    res.redirect('/');
  } catch (err) {
    return res.status(400).send('Error retrieving access token');
  }
});

// Endpoint to fetch user email & unread count
app.get('/user-info', async (req, res) => {
  try {
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const userEmail = profile.data.emailAddress;

    const messagesList = await gmail.users.messages.list({
      userId: 'me',
      q: "is:unread",
    });

    let unreadCount = messagesList.data.messages ? messagesList.data.messages.length : 0;
    let bvritImpCount = 0;

    if (messagesList.data.messages) {
      for (let message of messagesList.data.messages) {
        const msgDetails = await gmail.users.messages.get({ userId: 'me', id: message.id });
        const fromHeader = msgDetails.data.payload.headers.find(h => h.name === 'From')?.value || 'Unknown';
        const senderEmail = extractEmailAddress(fromHeader);

        if (importantBvrithEmailsList.includes(senderEmail)) {
          bvritImpCount++;
        }
      }
    }

    res.json({ email: userEmail, unreadCount, bvritImpCount });
  } catch (error) {
    console.error("Error fetching user info:", error);
    res.status(500).json({ error: "Failed to retrieve user information." });
  }
});

// Endpoint to fetch categorized emails for dashboard
app.get('/emails', (req, res) => {
  res.json(categorizedEmails);
});

// **New: GET /labels to fetch saved labels**
app.get('/labels', (req, res) => {
  res.json(labels);
});

// **New: POST /labels to create a new label**
app.post('/labels', (req, res) => {
  const { labelName, senderEmail } = req.body;

  if (!labelName || !senderEmail) {
    return res.status(400).json({ error: 'labelName and senderEmail are required' });
  }

  if (labels.find(l => l.labelName.toLowerCase() === labelName.toLowerCase())) {
    return res.status(409).json({ error: 'Label already exists' });
  }

  labels.push({ labelName, senderEmail: senderEmail.toLowerCase() });
  res.status(201).json({ message: 'Label created successfully' });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
