# TODO List

## Vim

- [ ] Add Vim supposrt for ctrl + E, ctrl + Y (scroll down and scroll up)

## Mobile integration (App)

- [ ] brainstorm: We may need to eventually move the processing to the background or use some worker to do it because right now the logic runs in frontend, and user can't really let it run in background so they have to stay on the page while waiting for the task to run. 

## PDF Processing
- [ ] Brainstorm: how to label the sections that need latex?
  - [ ] Think label them using claude Visual, but how can claude single out the section that needs latex processing? figure out how to single out latex then let Mathpix Convert API do the job then we process it into a good and consistent latex block then return wrap up that element and send it back to the NIB parser so it is a standalone compoenent?     
- [ ] Display full debug log while processing. Especially when they detect a component.
- [ ] Still having issue with PDFs that don't have TOC for the parser. They simply can't extract any text out of them. Those kinds of PDFs should be classified as general PDF and we should explore some existing PDF parsers to think about what to use. If we use Claude Visual straight up then it would be VERY expensive. We want to explore free options to first convert PDF into some form of texts such that cheaper AI models can process them and label each section with different categories, and assign them to sections like figure, texts etc. So the question becomes, is there a tool that can flatten any PDF into text and at least some form of processable format? And our parser needs to get smarter in terms of detecting sections and assign labels.
