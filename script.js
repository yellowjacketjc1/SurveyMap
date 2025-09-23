class SurveyMapApp {
    constructor() {
        // PDF and Page Data
        this.pdfDoc = null;
        this.pdfPage = null;

        // Main visible canvas
        this.canvas = document.getElementById('mapCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Off-screen canvas for high-res PDF rendering
        this.pageCanvas = document.createElement('canvas');
        this.pageCtx = this.pageCanvas.getContext('2d');

        // Transformation state
        this.rotation = 0;
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;

        // Panning state
        this.isDragging = false;
        this.lastX = 0;
        this.lastY = 0;

        this.initializeEventListeners();
        this.setupPdfJs();
    }

    setupPdfJs() {
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        } else {
            console.error('PDF.js library not loaded');
            alert('PDF.js library failed to load. Please refresh the page.');
        }
    }

    initializeEventListeners() {
        const pdfInput = document.getElementById('pdfInput');
        const uploadArea = document.getElementById('uploadArea');
        const uploadBtn = document.getElementById('uploadBtn');
        const rotationSlider = document.getElementById('rotationSlider');
        const scaleSlider = document.getElementById('scaleSlider');
        const resetBtn = document.getElementById('resetBtn');
        const exportBtn = document.getElementById('exportBtn');
        const menuToggle = document.getElementById('menuToggle');
        const controlsPanel = document.getElementById('controlsPanel');

        // File handling
        pdfInput.addEventListener('change', (e) => this.handleFileSelect(e));
        uploadBtn.addEventListener('click', () => pdfInput.click());
        uploadArea.addEventListener('click', () => pdfInput.click());

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') {
                this.loadPDF(files[0]);
            }
        });

        // Control panel
        rotationSlider.addEventListener('input', (e) => {
            this.rotation = parseInt(e.target.value);
            document.getElementById('rotationValue').textContent = `${this.rotation}°`;
            this.redraw();
        });

        scaleSlider.addEventListener('input', (e) => {
            this.scale = parseFloat(e.target.value);
            document.getElementById('scaleValue').textContent = `${Math.round(this.scale * 100)}%`;
            this.redraw();
        });

        resetBtn.addEventListener('click', () => this.resetView());
        exportBtn.addEventListener('click', () => this.exportMap());

        // Menu toggle
        menuToggle.addEventListener('click', () => controlsPanel.classList.toggle('open'));
        document.addEventListener('click', (e) => {
            if (!controlsPanel.contains(e.target) && !menuToggle.contains(e.target)) {
                controlsPanel.classList.remove('open');
            }
        });

        // Canvas interactions
        this.canvas.addEventListener('mousedown', (e) => this.startPan(e));
        this.canvas.addEventListener('mousemove', (e) => this.pan(e));
        this.canvas.addEventListener('mouseup', () => this.endPan());
        this.canvas.addEventListener('mouseleave', () => this.endPan());
        this.canvas.addEventListener('wheel', (e) => this.handleZoom(e));

        // Responsive canvas
        window.addEventListener('resize', () => this.resetView());
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file && file.type === 'application/pdf') {
            this.loadPDF(file);
        } else {
            alert('Please select a valid PDF file.');
        }
    }

    async loadPDF(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
            this.pdfDoc = pdf;
            this.pdfPage = await this.pdfDoc.getPage(1); // Load first page

            // Render to off-screen canvas at high resolution
            const pixelRatio = window.devicePixelRatio || 1;
            const viewport = this.pdfPage.getViewport({ scale: 2 * pixelRatio });
            this.pageCanvas.width = viewport.width;
            this.pageCanvas.height = viewport.height;
            
            await this.pdfPage.render({
                canvasContext: this.pageCtx,
                viewport: viewport,
            }).promise;
            
            // Show workspace and perform initial render
            document.getElementById('uploadSection').style.display = 'none';
            document.getElementById('mapWorkspace').style.display = 'flex';
            this.resetView();

        } catch (error) {
            console.error('Error loading PDF:', error);
            alert(`Error loading PDF: ${error.message}. Please try again.`);
        }
    }
    
    resetView() {
        if (!this.pdfPage) return;
        
        const container = document.getElementById('mapContainer');
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        
        // Calculate scale to fit the page inside the canvas
        const scaleX = this.canvas.width / this.pageCanvas.width;
        const scaleY = this.canvas.height / this.pageCanvas.height;
        this.scale = Math.min(scaleX, scaleY) * 0.95; // 95% to leave some padding

        // Center the page
        this.offsetX = (this.canvas.width - (this.pageCanvas.width * this.scale)) / 2;
        this.offsetY = (this.canvas.height - (this.pageCanvas.height * this.scale)) / 2;

        this.rotation = 0;
        
        // Update UI controls
        document.getElementById('rotationSlider').value = 0;
        document.getElementById('scaleSlider').value = this.scale;
        document.getElementById('rotationValue').textContent = '0°';
        document.getElementById('scaleValue').textContent = `${Math.round(this.scale * 100)}%`;
        
        this.redraw();
    }

    redraw() {
        if (!this.pdfPage) return;
        
        this.ctx.save();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.translate(this.offsetX, this.offsetY);

        // Apply rotation around the center of the visible part of the page
        const centerX = this.pageCanvas.width / 2;
        const centerY = this.pageCanvas.height / 2;
        this.ctx.translate(centerX * this.scale, centerY * this.scale);
        this.ctx.rotate((this.rotation * Math.PI) / 180);
        this.ctx.translate(-centerX * this.scale, -centerY * this.scale);

        this.ctx.scale(this.scale, this.scale);
        this.ctx.drawImage(this.pageCanvas, 0, 0);
        
        this.ctx.restore();
    }
    
    startPan(e) {
        this.isDragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
    }

    pan(e) {
        if (!this.isDragging) return;
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.offsetX += dx;
        this.offsetY += dy;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.redraw();
    }

    endPan() {
        this.isDragging = false;
    }

    handleZoom(e) {
        e.preventDefault();
        const zoomIntensity = 0.1;
        const direction = e.deltaY < 0 ? 1 : -1;
        const scaleFactor = 1 + direction * zoomIntensity;
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Position of the mouse relative to the transformed page
        const worldX = (mouseX - this.offsetX) / this.scale;
        const worldY = (mouseY - this.offsetY) / this.scale;
        
        this.scale *= scaleFactor;
        
        // Adjust offset to keep the point under the mouse stationary
        this.offsetX = mouseX - worldX * this.scale;
        this.offsetY = mouseY - worldY * this.scale;
        
        // Update slider
        document.getElementById('scaleSlider').value = this.scale;
        document.getElementById('scaleValue').textContent = `${Math.round(this.scale * 100)}%`;

        this.redraw();
    }

    exportMap() {
        if (!this.pdfPage) {
            alert('No map loaded to export.');
            return;
        }
        const link = document.createElement('a');
        link.download = 'survey_map.png';
        link.href = this.canvas.toDataURL();
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new SurveyMapApp();
});
