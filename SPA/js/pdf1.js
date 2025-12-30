// Reset the PDF export page so future content can start from a blank state.
function resetPdfPage(sectionRoot) {
    var placeholder;

    if (!sectionRoot) {
        return;
    }

    placeholder = sectionRoot.querySelector("#pdf-export-reset");

    if (!placeholder) {
        return;
    }

    placeholder.replaceChildren();
}

// Initialize PDF page one with a cleared layout.
function initPdfPage(sectionRoot) {
    resetPdfPage(sectionRoot);
}

// Refresh the PDF page when it becomes visible again.
function onShowPdfPage(sectionRoot) {
    resetPdfPage(sectionRoot);
}

export default Object.freeze({
    initPdfPage,
    onShowPdfPage
});
