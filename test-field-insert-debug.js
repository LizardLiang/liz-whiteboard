/**
 * [HADES-DEBUG] Quick test script to manually verify field insertion functionality
 * This will be removed after debugging
 */

// Function to simulate clicking the + button to add a new field
function testFieldInsert() {
  console.log('[HADES-DEBUG] Testing field insert functionality...')

  // Look for any tables on the canvas
  const tables = document.querySelectorAll('.react-flow__node-erTable')
  console.log('[HADES-DEBUG] Found tables:', tables.length)

  if (tables.length === 0) {
    console.log('[HADES-DEBUG] No tables found - cannot test field insertion')
    return
  }

  // Take the first table
  const firstTable = tables[0]
  console.log('[HADES-DEBUG] Testing on first table:', firstTable)

  // Look for the + button (add column button)
  const addButton = firstTable.querySelector(
    'button[aria-label="Add new column"]',
  )
  console.log('[HADES-DEBUG] Add button found:', !!addButton)

  if (!addButton) {
    console.log('[HADES-DEBUG] ERROR: Add button not found!')
    return
  }

  // Check if button is visible and clickable
  const buttonStyles = window.getComputedStyle(addButton)
  console.log('[HADES-DEBUG] Button display:', buttonStyles.display)
  console.log('[HADES-DEBUG] Button opacity:', buttonStyles.opacity)
  console.log(
    '[HADES-DEBUG] Button pointer-events:',
    buttonStyles.pointerEvents,
  )

  // Try to click it
  try {
    console.log('[HADES-DEBUG] Attempting to click add button...')
    addButton.click()

    // Check if the form appeared after click
    setTimeout(() => {
      const inputField = firstTable.querySelector(
        'input[placeholder="column name"]',
      )
      console.log(
        '[HADES-DEBUG] Input field appeared after click:',
        !!inputField,
      )

      if (inputField) {
        console.log('[HADES-DEBUG] SUCCESS: Field insert form is working')
      } else {
        console.log('[HADES-DEBUG] ERROR: Field insert form did not appear')
      }
    }, 100)
  } catch (error) {
    console.log('[HADES-DEBUG] ERROR clicking add button:', error)
  }
}

// Auto-run the test after a short delay to let the page load
setTimeout(() => {
  testFieldInsert()
}, 2000)

// Also make the function available in global scope for manual testing
window.testFieldInsert = testFieldInsert
