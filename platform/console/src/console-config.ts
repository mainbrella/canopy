// Public, build-time console configuration. Never put credentials here.
// Visibility controls discovery only; it does not provision or disable services.
export const consoleConfig = {
  name: "Mainbrella",
  products: [
    { id: "compute", name: "Compute", description: "Linux environments for apps and agents.", visible: true },
    { id: "builder", name: "Builder", description: "Build and preview apps with AI.", visible: true },
    { id: "voice", name: "Voice", description: "Voice agents for browser and phone conversations.", visible: true },
  ],
};
