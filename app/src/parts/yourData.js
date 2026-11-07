// "Your data" (stability batch 5, trust signals): where the work is kept and who can see it, in plain words. Its own
// small file, fetched when the sidebar's "Your data" is clicked (07-Nov-2026: out of the app's first file, for its size
// budget; the words unchanged). Cloud and askConfirm are the business logic's globals (legacy.js).
export default function yourData() {
  const signed = typeof Cloud === "object" && Cloud.on();
  askConfirm({ title: "Your data", ok: "Close", body:
    "<p><b>Where it is kept.</b> In this browser, on this computer" + (signed ? ", and in your firm’s FinCom account, so the firm’s people can open it on their own computers." : ". It stays on this computer only until you sign in to a firm account (Settings).") + "</p>" +
    "<p><b>Who can see it.</b> " + (signed ? "The people your firm’s owner has added (Settings → People), each with their role. Other firms using FinCom cannot open it." : "Only someone using this browser on this computer.") + "</p>" +
    "<p><b>On a shared computer.</b> " + (signed ? "Sign out when you finish (the firm menu at the top right → Sign out)." : "Use your own Windows account, or sign in to a firm account and sign out when you finish.") + "</p>" +
    "<p><b>Is it saved?</b> The line above today’s date at the foot of this menu says so: “Saved on this computer”" + (signed ? ", and when it was last synced with the firm account." : ".") + "</p>" });
}
