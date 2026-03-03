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

function handleRequest(params) {
    const action = params.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Users");

    if (!sheet) {
        return createJsonResponse({
            status: 'error',
            message: 'Database error: "Users" sheet tab not found.'
        });
    }

    const data = sheet.getDataRange().getValues();
    let response = { status: 'error', message: 'Unknown action requested.' };

    try {
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
