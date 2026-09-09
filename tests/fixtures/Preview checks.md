# Preview checks

Hold **Shift** while clicking these links. Start both local fixture servers before testing.

## Page motion

Open the [upper link](http://127.0.0.1:4180/article?motion-demo=upper). The source text remains visible while the page prepares. The page expands from the link and closes with the reverse movement. Try the left and right sidebars open and closed.

## Close or stay

Open [Close confirmation](http://127.0.0.1:4180/guard), type into the field, and click ×. Cancel keeps the text on the same page. Close again and choose Leave, then reopen: the field is empty. Keep as Obsidian tab preserves the page and its text.

## Resume reading

Open [Reading position](http://127.0.0.1:4180/article), scroll, close, and reopen the same link. It should return near the same position. [Open section 3 explicitly](http://127.0.0.1:4180/article#section-3) should follow the section link. Clear saved positions in Link Float settings to reset restoration.

Try the [lower link](http://127.0.0.1:4180/article?motion-demo=lower) to compare its opening origin. Close with × or Escape. Keep as tab should stop an opening transition without reloading the page.
