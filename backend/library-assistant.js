'use strict';

const MAX_ASSISTANT_MESSAGE_LENGTH = 500;
const MAX_ASSISTANT_RESULTS = 4;

const FAQS = [
  {
    id: 'about-library',
    phrases: ['what is this online library', 'what is this library', 'about this library'],
    answer: 'This online library lets members discover and read the library’s published digital books. It is read-only: books cannot be borrowed or reserved here.',
  },
  {
    id: 'search-books',
    phrases: ['how do i search for a book', 'how can i search', 'search the library'],
    answer: 'Open Explore Library and search by a book title, author, subject, category, or keyword. You can also use the filters to narrow the published collection.',
  },
  {
    id: 'create-account',
    phrases: ['create a member account', 'create an account', 'register for an account', 'how do i register'],
    answer: 'Choose Register from the library portal, enter a username, email address, and password, then check your inbox and confirm your email. New members must confirm their email before signing in.',
  },
  {
    id: 'sign-in',
    phrases: ['how do i sign in', 'cannot sign in', 'invalid username or password', 'login troubleshooting'],
    answer: 'Use your username or registered email and password on the member sign-in page. New accounts must confirm their email first. If you forgot your password, choose Forgot password and use the recovery link sent to your registered email.',
  },
  {
    id: 'supported-formats',
    phrases: ['which book formats', 'supported formats', 'does the library support epub', 'epub format', 'pdf or epub'],
    answer: 'The online reader currently supports PDF and plain text (TXT) books. EPUB is not supported at this time.',
  },
  {
    id: 'open-book',
    phrases: ['how do i open a book', 'how can i read a book', 'open a book online', 'how to read online', 'book details page', 'navigate to book details'],
    answer: 'In Explore Library, choose a published book and select Details, then Read Book. Only published books with an accessible PDF or TXT file can be opened.',
  },
  {
    id: 'continue-reading',
    phrases: ['continue reading', 'saved reading progress', 'remember my page', 'reading position'],
    answer: 'Your reading position is saved automatically for your account. Open the same book again to continue from the saved position. PDF pages scroll vertically; the reader also provides zoom and fit controls. TXT books scroll as text.',
  },
  {
    id: 'book-not-opening',
    phrases: ['cannot open a book', 'cannot read a book', 'book will not open', 'book fails to open', 'why can t i open a book', 'broken book file', 'report a broken book'],
    answer: 'Check that you are signed in, then return to the catalogue and try the book again. Only published books with an accessible PDF or TXT file can be read. If it still fails, contact the library administrator and include the book title and what happened.',
  },
  {
    id: 'account-details',
    phrases: ['update my account details', 'update account details', 'change my account details', 'change account details', 'change my email', 'change my username', 'update my profile'],
    answer: 'Open Account Settings to add or remove your profile picture. Username and email changes are not available in the member settings; contact the library administrator. Use Forgot password on the sign-in page to reset your password.',
  },
  {
    id: 'password-reset',
    phrases: ['reset my password', 'forgot my password', 'forgotten password', 'password recovery'],
    answer: 'Sign out if needed, open the member sign-in page, and choose Forgot password. Enter your registered email and use the recovery link sent by the system. The assistant will never ask you to share a password or recovery code.',
  },
  {
    id: 'email-confirmation',
    phrases: ['confirm my email', 'email verification', 'confirmation email', 'verify my account'],
    answer: 'New members need to confirm their email before signing in. Open the confirmation link in your inbox. If it has expired or did not arrive, choose “Didn’t receive your confirmation email?” on the sign-in page to request another.',
  },
  {
    id: 'sign-out',
    phrases: ['how do i sign out', 'how can i log out', 'sign out of my account'],
    answer: 'Select Sign out in the account area at the top of the page.',
  },
  {
    id: 'contact-library',
    phrases: ['contact the library administrator', 'contact library staff', 'library contact', 'who do i contact'],
    answer: '',
  },
];

const STOP_WORDS = new Set([
  'a','about','an','and','are','book','books','can','do','for','find','give','have','i','in','is','it','me','my','of','on','or','please','show','some','that','the','this','to','want','what','which','with','written','you',
]);

const SEARCH_EXPANSIONS = {
  cybersecurity: ['cyber','security','ethical','hacking','network','kali'],
  cyber: ['cybersecurity','security','ethical','hacking','network','kali'],
  security: ['cybersecurity','ethical','hacking','network','kali'],
  hacking: ['cybersecurity','security','ethical','network','kali'],
  kali: ['linux','security','hacking','network'],
  programming: ['programming','code','coding','python','software'],
  coding: ['programming','code','python','software'],
  gothic: ['gothic','fiction','classic','mystery'],
  beginner: ['basics','introduction','fundamentals'],
};

function validateAssistantMessage(value) {
  if (typeof value !== 'string') return { error: 'Enter a message for the Library Assistant.' };
  const message = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!message) return { error: 'Enter a message for the Library Assistant.' };
  if (message.length > MAX_ASSISTANT_MESSAGE_LENGTH) return { error: `Keep your message to ${MAX_ASSISTANT_MESSAGE_LENGTH} characters or fewer.` };
  return { message };
}

function matchFaq(message) {
  const normalized = normalizeText(message);
  const match = FAQS.find((faq) => faq.phrases.some((phrase) => normalized.includes(normalizeText(phrase))));
  return match || null;
}

function buildFaqAnswer(faq, contact = {}) {
  if (faq?.id !== 'contact-library') return faq?.answer || '';
  const email = typeof contact.email === 'string' ? contact.email.trim().slice(0, 254) : '';
  const phone = typeof contact.phone === 'string' ? contact.phone.trim().slice(0, 40) : '';
  const methods = [email && `email ${email}`, phone && `phone ${phone}`].filter(Boolean);
  return methods.length
    ? `The library contact details configured here are ${methods.join(' and ')}. You can also ask library staff for help in person.`
    : 'The library has not configured a contact email or phone number in this app. Please ask library staff at your institution for the appropriate support contact.';
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function queryTerms(message) {
  const words = normalizeText(message).split(' ').filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  const expanded = [...words];
  for (const word of words) expanded.push(...(SEARCH_EXPANSIONS[word] || []));
  return [...new Set(expanded)];
}

function isMemberReadableBook(book) {
  return book?.status === 'published'
    && Boolean(book.virtual_file_path)
    && ['application/pdf', 'text/plain'].includes(book.virtual_file_type)
    && Boolean(book.id && book.title && book.author);
}

function rankCatalogueBooks(books, message, limit = MAX_ASSISTANT_RESULTS) {
  const terms = queryTerms(message);
  if (!terms.length) return [];
  return (Array.isArray(books) ? books : [])
    .filter(isMemberReadableBook)
    .map((book) => {
      const fields = [
        [normalizeText(book.title), 9],
        [normalizeText(book.author), 8],
        [normalizeText(book.category), 7],
        [normalizeText(Array.isArray(book.tags) ? book.tags.join(' ') : book.tags), 5],
        [normalizeText(book.description), 2],
      ];
      const score = terms.reduce((total, term) => total + fields.reduce((fieldScore, [value, weight]) => fieldScore + (value.split(' ').includes(term) ? weight : 0), 0), 0);
      return { book, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || String(left.book.title).localeCompare(String(right.book.title)))
    .slice(0, limit)
    .map((item) => item.book);
}

function answerCatalogueQuestion(message, books) {
  const normalized = normalizeText(message);
  if (/\bby a particular author\b|\bby an author\b|\bby author\b/.test(normalized)) {
    return { type: 'clarification', answer: 'Which author should I search for? Enter the author’s name and I’ll look for matching books in the readable catalogue.', books: [] };
  }
  const matches = rankCatalogueBooks(books, message);
  return matches.length
    ? { type: 'catalogue', answer: matches.length === 1 ? 'This book is from the published, readable catalogue and may match your request.' : `These ${matches.length} books are from the published, readable catalogue and may match your request.`, books: matches }
    : { type: 'no-results', answer: 'I couldn’t find a published, readable book matching that request in the current catalogue. Try another title, author, subject, keyword, or category.', books: [] };
}

module.exports = {
  FAQS,
  MAX_ASSISTANT_MESSAGE_LENGTH,
  MAX_ASSISTANT_RESULTS,
  answerCatalogueQuestion,
  buildFaqAnswer,
  isMemberReadableBook,
  matchFaq,
  rankCatalogueBooks,
  validateAssistantMessage,
};
