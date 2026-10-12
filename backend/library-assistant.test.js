'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  answerCatalogueQuestion,
  buildFaqAnswer,
  isMemberReadableBook,
  matchFaq,
  rankCatalogueBooks,
  validateAssistantMessage,
} = require('./library-assistant');

const readableBook = (values = {}) => ({
  id: 1,
  title: 'Example Book',
  author: 'A. Writer',
  category: 'Computer Science',
  description: '',
  tags: [],
  status: 'published',
  virtual_file_path: 'private/example.pdf',
  virtual_file_type: 'application/pdf',
  ...values,
});

test('validates and normalizes bounded assistant messages', () => {
  assert.deepEqual(validateAssistantMessage('  Find\nbooks about Python  '), { message: 'Find books about Python' });
  assert.match(validateAssistantMessage('  ').error, /Enter a message/);
  assert.match(validateAssistantMessage('x'.repeat(501)).error, /500 characters/);
  assert.match(validateAssistantMessage({ text: 'hello' }).error, /Enter a message/);
});

test('only published books with accessible supported files qualify for matching', () => {
  assert.equal(isMemberReadableBook(readableBook()), true);
  assert.equal(isMemberReadableBook(readableBook({ status: 'draft' })), false);
  assert.equal(isMemberReadableBook(readableBook({ status: 'archived' })), false);
  assert.equal(isMemberReadableBook(readableBook({ virtual_file_path: '' })), false);
  assert.equal(isMemberReadableBook(readableBook({ virtual_file_type: 'application/epub+zip' })), false);
});

test('matches books by title, author, category, tags, and description', () => {
  const books = [
    readableBook({ id: 1, title: 'Linux Basics for Hackers', author: 'OccupyTheWeb', tags: ['cybersecurity'] }),
    readableBook({ id: 2, title: 'Python Data Science', author: 'Jane Writer', category: 'Programming' }),
    readableBook({ id: 3, title: 'Classic Gothic Fiction', author: 'A. Writer', category: 'Literature' }),
    readableBook({ id: 4, title: 'Software Engineering', author: 'Ian Sommerville', description: 'Requirements and software design' }),
  ];
  assert.equal(rankCatalogueBooks(books, 'books about cybersecurity')[0].id, 1);
  assert.equal(rankCatalogueBooks(books, 'books by Ian Sommerville')[0].id, 4);
  assert.equal(rankCatalogueBooks(books, 'programming')[0].id, 2);
  assert.equal(rankCatalogueBooks(books, 'Gothic novels')[0].id, 3);
  assert.equal(rankCatalogueBooks(books, 'requirements design')[0].id, 4);
});

test('topic recommendations return only matching catalogue records and no-results are honest', () => {
  const books = [readableBook({ id: 7, title: 'Kali Linux Security', author: 'A. Writer' })];
  assert.deepEqual(answerCatalogueQuestion('I am a beginner who wants to learn cybersecurity', books).books.map((book) => book.id), [7]);
  const noResults = answerCatalogueQuestion('books about marine biology', books);
  assert.equal(noResults.type, 'no-results');
  assert.deepEqual(noResults.books, []);
  assert.match(noResults.answer, /couldn’t find/);
  const needsAuthor = answerCatalogueQuestion('Find books by a particular author.', books);
  assert.equal(needsAuthor.type, 'clarification');
  assert.match(needsAuthor.answer, /Which author/);
});

test('FAQ answers cover reading, formats, password reset, and configured support', () => {
  assert.match(buildFaqAnswer(matchFaq('How do I open a book?')), /Details, then Read Book/);
  assert.match(buildFaqAnswer(matchFaq('Which book formats are supported?')), /PDF and plain text \(TXT\)/);
  assert.match(buildFaqAnswer(matchFaq('How do I reset my password?')), /Forgot password/);
  assert.match(buildFaqAnswer(matchFaq('How do I update account details?')), /Account Settings/);
  assert.match(buildFaqAnswer(matchFaq('How do I contact the library administrator?'), { email: 'library@example.org' }), /library@example.org/);
  assert.match(buildFaqAnswer(matchFaq('How do I contact the library administrator?')), /not configured/);
  assert.equal(matchFaq('What is my authenticator code?'), null);
});
