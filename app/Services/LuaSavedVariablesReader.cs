using System.Globalization;
using System.Text;

namespace XenonEdgeHost;

// Reads the file World of Warcraft writes for an add-on's saved data:
//
//     Name = {
//     ["key"] = "text",
//     ["count"] = 3,
//     { ["nested"] = true, }, -- [1]
//     }
//
// It reads data only. Nothing in the file is executed, and anything outside
// that shape (function calls, expressions, variables) is a format error.
internal static class LuaSavedVariablesReader
{
    internal const int MaxDepth = 12;
    internal const int MaxValues = 20000;

    // Returns the table assigned to `globalName`, or null when the text does
    // not contain one or is not in the saved-data format.
    internal static LuaTable? ReadTable(string text, string globalName)
    {
        try
        {
            var parser = new Parser(text);
            while (parser.SkipBlank())
            {
                var name = parser.ReadName();
                parser.Expect('=');
                var value = parser.ReadValue(0);
                if (string.Equals(name, globalName, StringComparison.Ordinal))
                {
                    return value as LuaTable;
                }
            }
        }
        catch (FormatException)
        {
        }

        return null;
    }

    internal sealed class LuaTable
    {
        internal Dictionary<string, object?> Fields { get; } = new(StringComparer.Ordinal);

        internal List<object?> Items { get; } = [];

        internal string? Text(string key)
        {
            return Fields.TryGetValue(key, out var value) ? value as string : null;
        }

        internal double? Number(string key)
        {
            return Fields.TryGetValue(key, out var value) && value is double number ? number : null;
        }

        internal bool Flag(string key)
        {
            return Fields.TryGetValue(key, out var value) && value is true;
        }

        internal LuaTable? Table(string key)
        {
            return Fields.TryGetValue(key, out var value) ? value as LuaTable : null;
        }
    }

    private sealed class Parser
    {
        private readonly string _text;
        private int _position;
        private int _values;

        internal Parser(string text)
        {
            _text = text ?? "";
        }

        // Skips spaces, line breaks and `--` comments. False at end of text.
        internal bool SkipBlank()
        {
            while (_position < _text.Length)
            {
                var current = _text[_position];
                if (char.IsWhiteSpace(current) || current == '﻿')
                {
                    _position++;
                }
                else if (current == '-' && _position + 1 < _text.Length && _text[_position + 1] == '-')
                {
                    while (_position < _text.Length && _text[_position] != '\n')
                    {
                        _position++;
                    }
                }
                else
                {
                    return true;
                }
            }

            return false;
        }

        internal void Expect(char expected)
        {
            if (!SkipBlank() || _text[_position] != expected)
            {
                throw new FormatException();
            }

            _position++;
        }

        internal string ReadName()
        {
            if (!SkipBlank() || !(char.IsAsciiLetter(_text[_position]) || _text[_position] == '_'))
            {
                throw new FormatException();
            }

            var start = _position;
            while (_position < _text.Length && (char.IsAsciiLetterOrDigit(_text[_position]) || _text[_position] == '_'))
            {
                _position++;
            }

            return _text[start.._position];
        }

        internal object? ReadValue(int depth)
        {
            if (!SkipBlank() || ++_values > MaxValues)
            {
                throw new FormatException();
            }

            var current = _text[_position];
            if (current == '{')
            {
                return ReadTable(depth + 1);
            }

            if (current == '"')
            {
                return ReadString();
            }

            if (current == '-' || current == '.' || char.IsAsciiDigit(current))
            {
                return ReadNumber();
            }

            return ReadName() switch
            {
                "true" => (object?)true,
                "false" => false,
                "nil" => null,
                _ => throw new FormatException()
            };
        }

        private LuaTable ReadTable(int depth)
        {
            if (depth > MaxDepth)
            {
                throw new FormatException();
            }

            Expect('{');
            var table = new LuaTable();
            while (true)
            {
                if (!SkipBlank())
                {
                    throw new FormatException();
                }

                var current = _text[_position];
                if (current == '}')
                {
                    _position++;
                    return table;
                }

                if (current == '[')
                {
                    _position++;
                    var key = ReadValue(depth);
                    Expect(']');
                    Expect('=');
                    var value = ReadValue(depth);
                    if (key is string name)
                    {
                        table.Fields[name] = value;
                    }
                    else if (key is double index)
                    {
                        // Older clients write list entries as [1] = value.
                        table.Fields[index.ToString(CultureInfo.InvariantCulture)] = value;
                        if (index == table.Items.Count + 1)
                        {
                            table.Items.Add(value);
                        }
                    }
                    else
                    {
                        throw new FormatException();
                    }
                }
                else if ((char.IsAsciiLetter(current) || current == '_') && IsNamedField())
                {
                    var name = ReadName();
                    Expect('=');
                    table.Fields[name] = ReadValue(depth);
                }
                else
                {
                    table.Items.Add(ReadValue(depth));
                }

                if (SkipBlank() && (_text[_position] == ',' || _text[_position] == ';'))
                {
                    _position++;
                }
            }
        }

        // True when the word at the cursor is followed by `=`, so it is a key
        // and not one of the values true, false or nil.
        private bool IsNamedField()
        {
            var saved = _position;
            ReadName();
            var named = SkipBlank() && _text[_position] == '=';
            _position = saved;
            return named;
        }

        private string ReadString()
        {
            _position++;
            var builder = new StringBuilder();
            var bytes = new List<byte>();

            void FlushBytes()
            {
                if (bytes.Count > 0)
                {
                    builder.Append(Encoding.UTF8.GetString(bytes.ToArray()));
                    bytes.Clear();
                }
            }

            while (true)
            {
                if (_position >= _text.Length)
                {
                    throw new FormatException();
                }

                var current = _text[_position++];
                if (current == '"')
                {
                    FlushBytes();
                    return builder.ToString();
                }

                if (current != '\\')
                {
                    FlushBytes();
                    builder.Append(current);
                    continue;
                }

                if (_position >= _text.Length)
                {
                    throw new FormatException();
                }

                var escaped = _text[_position++];
                if (char.IsAsciiDigit(escaped))
                {
                    // \ddd is one byte; several in a row spell a UTF-8 character.
                    var code = escaped - '0';
                    for (var digits = 1; digits < 3 && _position < _text.Length && char.IsAsciiDigit(_text[_position]); digits++)
                    {
                        code = (code * 10) + (_text[_position++] - '0');
                    }

                    if (code > 255)
                    {
                        throw new FormatException();
                    }

                    bytes.Add((byte)code);
                    continue;
                }

                FlushBytes();
                builder.Append(escaped switch
                {
                    'n' => '\n',
                    'r' => '\r',
                    't' => '\t',
                    'a' => '\a',
                    'b' => '\b',
                    'f' => '\f',
                    'v' => '\v',
                    '\\' => '\\',
                    '"' => '"',
                    '\'' => '\'',
                    '\n' => '\n',
                    _ => throw new FormatException()
                });
            }
        }

        private double ReadNumber()
        {
            var start = _position;
            while (_position < _text.Length
                && (char.IsAsciiLetterOrDigit(_text[_position]) || _text[_position] is '-' or '+' or '.'))
            {
                _position++;
            }

            if (!double.TryParse(
                    _text.AsSpan(start, _position - start),
                    NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint | NumberStyles.AllowExponent,
                    CultureInfo.InvariantCulture,
                    out var number)
                || double.IsNaN(number)
                || double.IsInfinity(number))
            {
                throw new FormatException();
            }

            return number;
        }
    }
}
