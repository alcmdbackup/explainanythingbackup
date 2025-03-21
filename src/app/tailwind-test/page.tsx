export default function TailwindTest() {
  return (
    <div className="min-h-screen bg-black py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Header */}
        <h1 className="text-4xl font-bold text-blue-600 text-center">
          Tailwind CSS Test Page
        </h1>

        {/* Colors */}
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold">Colors</h2>
          <div className="flex gap-2">
            <div className="w-20 h-20 bg-red-500 rounded-lg"></div>
            <div className="w-20 h-20 bg-blue-500 rounded-lg"></div>
            <div className="w-20 h-20 bg-green-500 rounded-lg"></div>
          </div>
        </div>

        {/* Typography */}
        <div className="space-y-8">
          <h2 className="text-2xl font-semibold">Typography</h2>
          
          {/* Basic Typography */}
          <div className="space-y-2">
            <h3 className="text-xl font-semibold">Basic Typography</h3>
            <p className="text-xs">Extra Small Text</p>
            <p className="text-xl">Extra Large Text</p>
            <p className="font-bold">Bold Text</p>
            <p className="italic">Italic Text</p>
            <p className="font-light">Light Text</p>
            <p className="underline">Underlined Text</p>
            <p className="line-through">Strikethrough Text</p>
          </div>

          {/* Prose Example */}
          <div className="space-y-2">
            <h3 className="text-xl font-semibold">Prose Example</h3>
            <div className="prose prose-invert"> {/* prose-invert for dark mode */}
              <h1>Main Heading</h1>
              <h2>Subheading</h2>
              <p>
                This is a paragraph with <strong>bold text</strong> and <em>italic text</em>.
                The typography plugin automatically handles proper spacing and styling.
              </p>
              <ul>
                <li>First item</li>
                <li>Second item</li>
                <li>Third item</li>
              </ul>
              <blockquote>
                This is a blockquote that demonstrates the typography plugin's styling
              </blockquote>
            </div>
          </div>
        </div>

        {/* Spacing & Layout */}
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold">Spacing & Layout</h2>
          <div className="flex gap-4">
            <div className="p-4 bg-purple-200">Padding</div>
            <div className="m-4 bg-yellow-200">Margin</div>
          </div>
        </div>

        {/* Hover & Interactive Elements */}
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold">Interactive Elements</h2>
          <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
            Hover Me
          </button>
        </div>
      </div>
    </div>
  )
} 