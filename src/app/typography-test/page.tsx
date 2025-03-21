export default function TypographyTest() {
  return (
    <div className="min-h-screen p-8 bg-white dark:bg-gray-900">
      {/* Test 1: Basic Prose */}
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold mb-4">1. Basic Prose Test</h2>
        <div className="prose prose-lg prose-slate max-w-none dark:prose-invert">
          <h1>This should be a large, well-styled heading</h1>
          <p>This paragraph should have proper spacing and line height. It should look noticeably different from text without the prose class.</p>
          <ul>
            <li>This list should be properly indented</li>
            <li>With bullets styled nicely</li>
            <li>And proper spacing between items</li>
          </ul>
          <blockquote>
            This blockquote should have a left border and proper indentation
          </blockquote>
        </div>

        {/* Test 2: Regular Text (For Comparison) */}
        <h2 className="text-2xl font-bold my-8">2. Regular Text (Without Prose)</h2>
        <div>
          <h1>This heading will look basic</h1>
          <p>This paragraph won't have the typography plugin styling.</p>
          <ul>
            <li>This list won't have proper spacing</li>
            <li>Or nice bullets</li>
          </ul>
          <blockquote>
            This blockquote will look plain
          </blockquote>
        </div>
      </div>
    </div>
  )
} 