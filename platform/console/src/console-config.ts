// Public, build-time console configuration. Never put credentials here.
// Visibility controls discovery only; it does not provision or disable services.
const selection: string[] | undefined = import.meta.env.VITE_PRODUCT_SELECTION === undefined ? undefined : import.meta.env.VITE_PRODUCT_SELECTION.split(",").filter(Boolean);
export const consoleConfig = {
  name: import.meta.env.VITE_INSTANCE_NAME || "Mainbrella",
  products: [
    { id: "compute", name: "Compute", description: "Linux environments for apps and agents.", visible: true },
    { id: "builder", name: "Builder", description: "Build and preview apps with AI.", visible: true },
    { id: "voice", name: "Voice", description: "Voice agents for browser and phone conversations.", visible: true },
    { id: "cut", name: "Cut", description: "A link shortener installed with Appflare.", visible: false },
  ].map(product => ({ ...product, visible: selection ? selection.includes(product.id) : product.visible })),
};
