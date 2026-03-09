const GOOGLE_URL = 'https://script.google.com/macros/s/AKfycby43nl9_mMl4L874fYORDY9Qx-2PoxjW9TGQ9OUYpRjmLR27Np_Gdc84WDYq1_8bEyv/exec';

/**
 * GOOGLE APPS SCRIPT BACKEND - WAKEUP AI
 * * SETUP INSTRUCTIONS:
 * 1. Create a Google Sheet.
 * 2. Rename the first tab to "Users".
 * 3. Add headers in Row 1: 
 * Email | Password | DisplayName | TotalMinutesUsed | LastLogin | Status | CreatedAt
 * 4. Open Extensions > Apps Script and paste this code.
 * 5. Deploy as Web App: Execute as "Me", Access: "Anyone".
 */

function doPost(e) {
    return handleRequest(e.parameter);
}

function doGet(e) {
    return handleRequest(e.parameter);
}

/**
 * RUN THIS ONCE to authorize the script!
 * Click "Run" on this function to trigger the "Review Permissions" dialog.
 */
function authorizeScript() {
    // Just fetching a public URL to trigger the "external_request" permission popup
    UrlFetchApp.fetch("https://www.google.com", { muteHttpExceptions: true });
    Logger.log("Authorization successful!");
}

function handleRequest(params) {
    const action = params.action;
    let response = { status: 'error', message: 'Unknown action requested.' };

    try {
        // --- PROXY ACTIONS (No Spreadsheet needed) ---
        if (action === 'getDeepgramUsage') {
            const apiKey = params.apiKey;
            if (!apiKey) return createJsonResponse({ status: 'error', message: 'API Key is required.' });

            const headers = { 'Authorization': 'Token ' + apiKey };

            // 1. Get Projects
            const projectsRes = UrlFetchApp.fetch('https://api.deepgram.com/v1/projects', {
                headers: headers,
                muteHttpExceptions: true
            });

            if (projectsRes.getResponseCode() !== 200) {
                return createJsonResponse({ status: 'error', message: 'Deepgram Auth Failed' });
            }

            const projectsData = JSON.parse(projectsRes.getContentText());
            if (!projectsData.projects || projectsData.projects.length === 0) {
                return createJsonResponse({ status: 'error', message: 'No projects found' });
            }

            let totalRemaining = 0;
            let totalEverAdded = 0;
            let units = '$';
            let mainProjectName = '';
            let projectsInspected = 0;
            let debugInfo = [];

            // 2. Iterate through all projects to find balances
            for (let p = 0; p < projectsData.projects.length; p++) {
                const project = projectsData.projects[p];
                const projectId = project.project_id;
                if (p === 0) mainProjectName = project.name;
                projectsInspected++;

                const balanceRes = UrlFetchApp.fetch('https://api.deepgram.com/v1/projects/' + projectId + '/balances', {
                    headers: headers,
                    muteHttpExceptions: true
                });

                let rawBalance = 'None';
                if (balanceRes.getResponseCode() === 200) {
                    rawBalance = balanceRes.getContentText();
                    const balanceData = JSON.parse(rawBalance);
                    if (balanceData.balances) {
                        balanceData.balances.forEach(bal => {
                            // Use parseFloat to ensure numeric addition
                            const amt = parseFloat(bal.amount) || 0;
                            const total = parseFloat(bal.total_amount || bal.amount) || 0;

                            totalRemaining += amt;
                            totalEverAdded += total;

                            if (bal.units === 'USD') units = '$';
                            else if (bal.units) units = bal.units;
                        });
                    }
                }

                debugInfo.push({
                    projectId: projectId,
                    projectName: project.name,
                    status: balanceRes.getResponseCode(),
                    raw: rawBalance
                });
            }

            return createJsonResponse({
                status: 'success',
                data: {
                    remaining: totalRemaining,
                    status: projectsData.projects.length > 0 ? 200 : 404,
                    projectName: mainProjectName
                }
            });
        }

        // --- SPREADSHEET ACTIONS ---
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss.getSheetByName("Users");

        if (!sheet) {
            return createJsonResponse({
                status: 'error',
                message: 'Database error: "Users" sheet tab not found.'
            });
        }

        const data = sheet.getDataRange().getValues();
        // --- ACTION: REGISTER ---
        if (action === 'register') {
            const email = params.email ? params.email.trim().toLowerCase() : "";
            const password = params.password;
            const displayName = params.displayName || email.split('@')[0];

            if (!email || !password) {
                return createJsonResponse({ status: 'error', message: 'Email and password are required.' });
            }

            let exists = false;
            for (let i = 1; i < data.length; i++) {
                if (data[i][0].toString().toLowerCase() === email) {
                    exists = true;
                    break;
                }
            }

            if (exists) {
                response.message = 'An account with this email already exists.';
            } else {
                sheet.appendRow([
                    email,
                    password,
                    displayName,
                    0,
                    new Date().toISOString(),
                    'offline',
                    new Date().toISOString()
                ]);
                response.status = 'success';
                response.message = 'Registration successful.';
            }
        }

        // --- ACTION: LOGIN ---
        else if (action === 'login') {
            const email = params.email ? params.email.trim().toLowerCase() : "";
            const password = params.password;
            let found = false;

            for (let i = 1; i < data.length; i++) {
                const sheetEmail = data[i][0].toString().toLowerCase();
                const sheetPass = data[i][1].toString();

                if (sheetEmail === email && sheetPass === password.toString()) {
                    sheet.getRange(i + 1, 5).setValue(new Date().toISOString());
                    sheet.getRange(i + 1, 6).setValue('online');

                    response.status = 'success';
                    response.user = {
                        email: data[i][0],
                        displayName: data[i][2],
                        totalMinutesUsed: data[i][3],
                        lastLogin: new Date().toISOString()
                    };
                    found = true;
                    break;
                }
            }
            if (!found) response.message = 'Invalid email or password credentials.';
        }

        // --- ACTION: GET USER DATA ---
        else if (action === 'getUser') {
            const email = params.email ? params.email.trim().toLowerCase() : "";
            for (let i = 1; i < data.length; i++) {
                if (data[i][0].toString().toLowerCase() === email) {
                    response.status = 'success';
                    response.user = {
                        email: data[i][0],
                        displayName: data[i][2],
                        totalMinutesUsed: data[i][3],
                        lastLogin: data[i][4],
                        status: data[i][5]
                    };
                    break;
                }
            }
        }

        // --- ACTION: UPDATE USAGE MINUTES ---
        else if (action === 'updateUsage') {
            const email = params.email ? params.email.trim().toLowerCase() : "";
            const mins = parseFloat(params.minutes) || 0;

            for (let i = 1; i < data.length; i++) {
                if (data[i][0].toString().toLowerCase() === email) {
                    const current = parseFloat(data[i][3]) || 0;
                    sheet.getRange(i + 1, 4).setValue(current + mins);
                    response.status = 'success';
                    response.message = 'Usage synced.';
                    break;
                }
            }
        }

        // --- ACTION: LOGOUT ---
        else if (action === 'logout') {
            const email = params.email ? params.email.trim().toLowerCase() : "";
            for (let i = 1; i < data.length; i++) {
                if (data[i][0].toString().toLowerCase() === email) {
                    sheet.getRange(i + 1, 6).setValue('offline');
                    response.status = 'success';
                    break;
                }
            }
        }

        // --- ACTION: FORGOT PASSWORD ---
        else if (action === 'forgotPassword') {
            const email = params.email ? params.email.trim().toLowerCase() : "";
            let found = false;

            for (let i = 1; i < data.length; i++) {
                if (data[i][0].toString().toLowerCase() === email) {
                    // Generate a random temporary password (6 characters)
                    const tempPassword = Math.random().toString(36).slice(-6);
                    const displayName = data[i][2];

                    // Update the password in the sheet
                    sheet.getRange(i + 1, 2).setValue(tempPassword);

                    // Send the email
                    const subject = "Wakeup AI - Password Reset";
                    const body = `Hello ${displayName},\n\nYour password has been reset.\n\nYour new temporary password is: ${tempPassword}\n\nPlease login using this temporary password.\n\nBest,\nWakeup AI Team`;

                    MailApp.sendEmail(email, subject, body);

                    response.status = 'success';
                    response.message = 'A temporary password has been sent to your email.';
                    found = true;
                    break;
                }
            }

            if (!found) {
                response.status = 'error';
                response.message = 'If this email exists in our system, a password reset link was sent.';
            }
        }

        // --- ACTION: UPLOAD TRANSCRIPT ---
        else if (action === 'uploadTranscript') {
            const email = params.email ? params.email.trim().toLowerCase() : "unknown@email.com";
            const topic = params.topic || "Untitled Session";
            const transcriptText = params.transcript || "";

            if (!transcriptText) {
                return createJsonResponse({ status: 'error', message: 'No transcript text provided.' });
            }

            // 1. Create the File in the specific Google Drive Folder
            const FOLDER_ID = "1sEZAHc_VGMDsDv776Ew4dpJDSbLYyXCW";
            const dateStr = new Date().toLocaleDateString();
            const fileName = `${dateStr} - ${topic} Transcript.txt`;

            let targetFolder;
            try {
                targetFolder = DriveApp.getFolderById(FOLDER_ID);
            } catch (e) {
                // Fallback to root if folder ID is invalid/inaccessible
                targetFolder = DriveApp.getRootFolder();
            }

            const file = targetFolder.createFile(fileName, transcriptText, MimeType.PLAIN_TEXT);
            const fileUrl = file.getUrl();

            // Optional: Make it viewable by anyone with the link
            // file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

            // 2. Add a record to the "Transcripts" sheet
            let transcriptSheet = ss.getSheetByName("Transcripts");
            if (!transcriptSheet) {
                // Auto-create the sheet if it doesn't exist
                transcriptSheet = ss.insertSheet("Transcripts");
                transcriptSheet.appendRow(["Email", "Date", "Topic", "Document URL"]);
                // Bold the headers
                transcriptSheet.getRange("A1:D1").setFontWeight("bold");
            }

            transcriptSheet.appendRow([
                email,
                new Date().toISOString(),
                topic,
                fileUrl
            ]);

            response.status = 'success';
            response.message = 'Transcript securely saved.';
            response.url = fileUrl;
        }

        // --- ACTION: SUBMIT FEEDBACK ---
        else if (action === 'submitFeedback') {
            const email = params.email || "guest";
            const topic = params.topic || "Untitled Session";
            const rating = params.rating || 0;
            const comment = params.comment || "";

            let feedbackSheet = ss.getSheetByName("Feedback");
            if (!feedbackSheet) {
                feedbackSheet = ss.insertSheet("Feedback");
                feedbackSheet.appendRow(["Email", "Topic", "Date", "Rating", "Comment"]);
                feedbackSheet.getRange("A1:E1").setFontWeight("bold");
            }

            feedbackSheet.appendRow([
                email,
                topic,
                new Date().toISOString(),
                rating,
                comment
            ]);

            response.status = 'success';
            response.message = 'Feedback saved.';
        }

        // --- ACTION: SAVE DEEPGRAM KEY (Silent) ---
        else if (action === 'saveDeepgramKey') {
            const email = params.email ? params.email.trim().toLowerCase() : "";
            const key = params.apiKey;

            if (!email || !key) {
                return createJsonResponse({ status: 'error', message: 'Email and Key are required.' });
            }

            // Ensure column exists (Column 8: DeepgramKey)
            const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
            let keyColIdx = headers.indexOf("DeepgramKey") + 1;

            if (keyColIdx === 0) {
                keyColIdx = sheet.getLastColumn() + 1;
                sheet.getRange(1, keyColIdx).setValue("DeepgramKey").setFontWeight("bold");
            }

            let found = false;
            for (let i = 1; i < data.length; i++) {
                if (data[i][0].toString().toLowerCase() === email) {
                    sheet.getRange(i + 1, keyColIdx).setValue(key);
                    response.status = 'success';
                    response.message = 'Key persisted.';
                    found = true;
                    break;
                }
            }
            if (!found) response.message = 'User not found.';
        }
    } catch (err) {
        response.status = 'error';
        response.message = 'Script Error: ' + err.toString();
    }

    return createJsonResponse(response);
}

function createJsonResponse(data) {
    const jsonString = JSON.stringify(data);
    return ContentService.createTextOutput(jsonString)
        .setMimeType(ContentService.MimeType.JSON);
}
