export const loadTemplate = async (templatePath) => {
  try {
    const response = await fetch(templatePath);

    if (!response.ok) {
      throw new Error(`Failed to load modal template: ${response.status}`);
    }

    const templateHTML = await response.text();
    const templateWrapper = document.createElement('div');
    templateWrapper.innerHTML = templateHTML.trim();

    const fragment = document.createDocumentFragment();
    Array.from(templateWrapper.childNodes).forEach((node) => fragment.appendChild(node));

    document.body.appendChild(fragment);
  } catch (error) {
    console.error(error);
  }
};
