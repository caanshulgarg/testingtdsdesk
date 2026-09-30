// A piece of an old screen (HTML text from a view…() function in src/js) shown inside a React screen, until that
// piece moves to React too. Its buttons keep working through the old click handlers.
export default function Legacy({ html, as: Tag = "div", ...rest }) {
  if (!html) return null;
  return <Tag style={{ display: "contents" }} {...rest} dangerouslySetInnerHTML={{ __html: html }} />;
}
