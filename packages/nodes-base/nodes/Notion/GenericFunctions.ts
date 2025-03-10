import {
	OptionsWithUri,
} from 'request';

import {
	IExecuteFunctions,
	IExecuteSingleFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
} from 'n8n-core';

import {
	IBinaryKeyData,
	ICredentialDataDecryptedObject,
	ICredentialTestFunctions,
	IDataObject,
	IDisplayOptions,
	INodeExecutionData,
	INodeProperties,
	IPollFunctions,
	NodeApiError,
} from 'n8n-workflow';

import {
	camelCase,
	capitalCase,
} from 'change-case';

import {
	filters,
} from './Filters';

import * as moment from 'moment-timezone';

import { validate as uuidValidate } from 'uuid';

import { snakeCase } from 'change-case';

const apiVersion: { [key: number]: string } = {
	1: '2021-05-13',
	2: '2021-08-16',
};

export async function notionApiRequest(this: IHookFunctions | IExecuteFunctions | IExecuteSingleFunctions | ILoadOptionsFunctions | IPollFunctions, method: string, resource: string, body: any = {}, qs: IDataObject = {}, uri?: string, option: IDataObject = {}): Promise<any> { // tslint:disable-line:no-any

	try {
		let options: OptionsWithUri = {
			headers: {
				'Notion-Version': apiVersion[this.getNode().typeVersion],
			},
			method,
			qs,
			body,
			uri: uri || `https://api.notion.com/v1${resource}`,
			json: true,
		};
		options = Object.assign({}, options, option);
		const credentials = await this.getCredentials('notionApi') as IDataObject;
		if (!uri) {
			//do not include the API Key when downloading files, else the request fails
			options!.headers!['Authorization'] = `Bearer ${credentials.apiKey}`;
		}
		if (Object.keys(body).length === 0) {
			delete options.body;
		}
		return this.helpers.request!(options);

	} catch (error) {
		throw new NodeApiError(this.getNode(), error);
	}
}

export async function notionApiRequestAllItems(this: IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions, propertyName: string, method: string, endpoint: string, body: any = {}, query: IDataObject = {}): Promise<any> { // tslint:disable-line:no-any

	const resource = this.getNodeParameter('resource', 0) as string;

	const returnData: IDataObject[] = [];

	let responseData;

	do {
		responseData = await notionApiRequest.call(this, method, endpoint, body, query);
		const { next_cursor } = responseData;
		if (resource === 'block' || resource === 'user') {
			query['start_cursor'] = next_cursor;
		} else {
			body['start_cursor'] = next_cursor;
		}
		returnData.push.apply(returnData, responseData[propertyName]);
		if (query.limit && query.limit <= returnData.length) {
			return returnData;
		}
	} while (
		responseData.has_more !== false
	);

	return returnData;
}

export function getBlockTypes() {
	return [
		{
			name: 'Paragraph',
			value: 'paragraph',
		},
		{
			name: 'Heading 1',
			value: 'heading_1',
		},
		{
			name: 'Heading 2',
			value: 'heading_2',
		},
		{
			name: 'Heading 3',
			value: 'heading_3',
		},
		{
			name: 'Toggle',
			value: 'toggle',
		},
		{
			name: 'To-Do',
			value: 'to_do',
		},
		// {
		// 	name: 'Child Page',
		// 	value: 'child_page',
		// },
		{
			name: 'Bulleted List Item',
			value: 'bulleted_list_item',
		},
		{
			name: 'Numbered List Item',
			value: 'numbered_list_item',
		},
	];
}

function textContent(content: string) {
	return {
		text: {
			content,
		},
	};
}

export function formatTitle(content: string) {
	return {
		title: [
			textContent(content),
		],
	};
}

export function formatText(content: string) {
	return {
		text: [
			textContent(content),
		],
	};
}

function getLink(text: { textLink: string, isLink: boolean }) {
	if (text.isLink === true && text.textLink !== '') {
		return {
			link: {
				url: text.textLink,
			},
		};
	}
	return {};
}

function getTexts(texts: [{ textType: string, text: string, isLink: boolean, range: boolean, textLink: string, mentionType: string, dateStart: string, dateEnd: string, date: string, annotationUi: IDataObject, expression: string }]) {
	const results = [];
	for (const text of texts) {
		if (text.textType === 'text') {
			results.push({
				type: 'text',
				text: {
					content: text.text,
					...getLink(text),
				},
				annotations: text.annotationUi,
			});
		} else if (text.textType === 'mention') {
			if (text.mentionType === 'date') {
				results.push({
					type: 'mention',
					mention: {
						type: text.mentionType,
						[text.mentionType]: (text.range === true)
							? { start: text.dateStart, end: text.dateEnd }
							: { start: text.date, end: null },
					},
					annotations: text.annotationUi,
				});
			} else {
				//@ts-ignore
				results.push({
					type: 'mention',
					mention: {
						type: text.mentionType,
						//@ts-ignore
						[text.mentionType]: { id: text[text.mentionType] as string },
					},
					annotations: text.annotationUi,
				});
			}
		} else if (text.textType === 'equation') {
			results.push({
				type: 'equation',
				equation: {
					expression: text.expression,
				},
				annotations: text.annotationUi,
			});
		}
	}
	return results;
}

export function formatBlocks(blocks: IDataObject[]) {
	const results = [];
	for (const block of blocks) {
		results.push({
			object: 'block',
			type: block.type,
			[block.type as string]: {
				...(block.type === 'to_do') ? { checked: block.checked } : {},
				//@ts-expect-error
				// tslint:disable-next-line: no-any
				text: (block.richText === false) ? formatText(block.textContent).text : getTexts(block.text.text as any || []),
			},
		});
	}
	return results;
}

// tslint:disable-next-line: no-any
function getPropertyKeyValue(value: any, type: string, timezone: string, version = 1) {
	let result = {};
	switch (type) {
		case 'rich_text':
			if (value.richText === false) {
				result = { rich_text: [{ text: { content: value.textContent } }] };
			} else {
				result = { rich_text: getTexts(value.text.text) };
			}
			break;
		case 'title':
			result = { title: [{ text: { content: value.title } }] };
			break;
		case 'number':
			result = { type: 'number', number: value.numberValue };
			break;
		case 'url':
			result = { type: 'url', url: value.urlValue };
			break;
		case 'checkbox':
			result = { type: 'checkbox', checkbox: value.checkboxValue };
			break;
		case 'relation':
			result = {
				// tslint:disable-next-line: no-any
				type: 'relation', relation: (value.relationValue).reduce((acc: [], cur: any) => {
					return acc.concat(cur.split(',').map((relation: string) => ({ id: relation })));
				}, []),
			};
			break;
		case 'multi_select':
			const multiSelectValue = value.multiSelectValue;
			result = {
				type: 'multi_select',
				// tslint:disable-next-line: no-any
				multi_select: (Array.isArray(multiSelectValue) ? multiSelectValue : multiSelectValue.split(',').map((v: string) => v.trim()))
					// tslint:disable-next-line: no-any
					.filter((value: any) => value !== null)
					.map((option: string) =>
						((!uuidValidate(option)) ? { name: option } : { id: option })),
			};
			break;
		case 'email':
			result = {
				type: 'email', email: value.emailValue,
			};
			break;
		case 'people':
			//if expression it's a single value, make it an array
			if (!Array.isArray(value.peopleValue)) {
				value.peopleValue = [value.peopleValue];
			}

			result = {
				type: 'people', people: value.peopleValue.map((option: string) => ({ id: option })),
			};
			break;
		case 'phone_number':
			result = {
				type: 'phone_number', phone_number: value.phoneValue,
			};
			break;
		case 'select':
			result = {
				type: 'select', select: (version === 1) ? { id: value.selectValue } : { name: value.selectValue },
			};
			break;
		case 'date':
			const format = getDateFormat(value.includeTime);
			const timezoneValue = (value.timezone === 'default') ? timezone : value.timezone;
			if (value.range === true) {
				result = {
					type: 'date',
					date: {
						start: moment.tz(value.dateStart, timezoneValue).format(format),
						end: moment.tz(value.dateEnd, timezoneValue).format(format),
					},
				};
			} else {
				result = {
					type: 'date',
					date: {
						start: moment.tz(value.date, timezoneValue).format(format),
						end: null,
					},
				};
			}

			//if the date was left empty, set it to null so it resets the value in notion
			if (value.date === '' ||
				(value.dateStart === '' && value.dateEnd === '')) {
				//@ts-ignore
				result.date = null;
			}

			break;
		case 'files':
			result = {
				type: 'files', files: value.fileUrls.fileUrl
					.map((file: { name: string, url: string }) => ({ name: file.name, type: 'external', external: { url: file.url } })),
			};
			break;
		default:
	}
	return result;
}

function getDateFormat(includeTime: boolean) {
	if (includeTime === false) {
		return 'yyyy-MM-DD';
	}
	return '';
}

function getNameAndType(key: string) {
	const [name, type] = key.split('|');
	return {
		name,
		type,
	};
}

export function mapProperties(properties: IDataObject[], timezone: string, version = 1) {
	return properties.reduce((obj, value) => Object.assign(obj, {
		[`${(value.key as string).split('|')[0]}`]: getPropertyKeyValue(value, (value.key as string).split('|')[1], timezone, version),
	}), {});
}

export function mapSorting(data: [{ key: string, type: string, direction: string, timestamp: boolean }]) {
	return data.map((sort) => {
		return {
			direction: sort.direction,
			[(sort.timestamp) ? 'timestamp' : 'property']: sort.key.split('|')[0],
		};
	});
}

export function mapFilters(filters: IDataObject[], timezone: string) {

	// tslint:disable-next-line: no-any
	return filters.reduce((obj, value: { [key: string]: any }) => {
		let key = getNameAndType(value.key).type;

		let valuePropertyName = key === 'last_edited_time'
			? value[camelCase(key)]
			: value[`${camelCase(key)}Value`];

		if (['is_empty', 'is_not_empty'].includes(value.condition as string)) {
			valuePropertyName = true;
		} else if (['past_week', 'past_month', 'past_year', 'next_week', 'next_month', 'next_year'].includes(value.condition as string)) {
			valuePropertyName = {};
		}
		if (key === 'rich_text' || key === 'text') {
			key = 'text';
		} else if (key === 'phone_number') {
			key = 'phone';
		} else if (key === 'date' && !['is_empty', 'is_not_empty'].includes(value.condition as string)) {
			valuePropertyName = (valuePropertyName !== undefined && !Object.keys(valuePropertyName).length) ? {} : moment.tz(value.date, timezone).utc().format();
		} else if (key === 'number') {
			key = 'text';
		} else if (key === 'boolean') {
			key = 'checkbox';
		}

		if (value.type === 'formula') {
			const valuePropertyName = value[`${camelCase(value.returnType)}Value`];

			return Object.assign(obj, {
				['property']: getNameAndType(value.key).name,
				[key]: { [value.returnType]: { [`${value.condition}`]: valuePropertyName } },
			});
		}

		return Object.assign(obj, {
			['property']: getNameAndType(value.key).name,
			[key]: { [`${value.condition}`]: valuePropertyName },
		});
	}, {});
}

// tslint:disable-next-line: no-any
function simplifyProperty(property: any) {
	// tslint:disable-next-line: no-any
	let result: any;
	const type = (property as IDataObject).type as string;
	if (['text'].includes(property.type)) {
		result = property.plain_text;
	} else if (['rich_text', 'title'].includes(property.type)) {
		if (Array.isArray(property[type]) && property[type].length !== 0) {
				// tslint:disable-next-line: no-any
			result = property[type].map((text: any) => simplifyProperty(text) as string).join('');
		} else {
			result = '';
		}
	} else if (['url', 'created_time', 'checkbox', 'number', 'last_edited_time', 'email', 'phone_number', 'date'].includes(property.type)) {
		// tslint:disable-next-line: no-any
		result = property[type] as any;
	} else if (['created_by', 'last_edited_by', 'select'].includes(property.type)) {
		result = (property[type]) ? property[type].name : null;
	} else if (['people'].includes(property.type)) {
		if (Array.isArray(property[type])) {
			// tslint:disable-next-line: no-any
			result = property[type].map((person: any) => person.person?.email || {});
		} else {
			result = property[type];
		}
	} else if (['multi_select'].includes(property.type)) {
		if (Array.isArray(property[type])) {
			result = property[type].map((e: IDataObject) => e.name || {});
		} else {
			result = property[type].options.map((e: IDataObject) => e.name || {});
		}
	} else if (['relation'].includes(property.type)) {
		if (Array.isArray(property[type])) {
			result = property[type].map((e: IDataObject) => e.id || {});
		} else {
			result = property[type].database_id;
		}
	} else if (['formula'].includes(property.type)) {
		result = property[type][property[type].type];

	} else if (['rollup'].includes(property.type)) {
		const rollupFunction = property[type].function as string;
		if (rollupFunction.startsWith('count') || rollupFunction.includes('empty')) {
			result = property[type].number;
			if (rollupFunction.includes('percent')) {
				result = result * 100;
			}
		} else if (rollupFunction.startsWith('show') && property[type].type === 'array') {
			const elements = property[type].array.map(simplifyProperty).flat();
			result = rollupFunction === 'show_unique' ? [...new Set(elements)] : elements;
		}
	} else if (['files'].includes(property.type)) {
		// tslint:disable-next-line: no-any
		result = property[type].map((file: { type: string, [key: string]: any }) => (file[file.type].url));
	}
	return result;
}

// tslint:disable-next-line: no-any
export function simplifyProperties(properties: any) {
	// tslint:disable-next-line: no-any
	const results: any = {};
	for (const key of Object.keys(properties)) {
		results[`${key}`] = simplifyProperty(properties[key]);
	}
	return results;
}

// tslint:disable-next-line: no-any
export function simplifyObjects(objects: any, download = false, version = 2) {
	if (!Array.isArray(objects)) {
		objects = [objects];
	}
	const results: IDataObject[] = [];
	for (const { object, id, properties, parent, title, json, binary, url, created_time, last_edited_time } of objects) {
		if (object === 'page' && (parent.type === 'page_id' || parent.type === 'workspace')) {
			results.push({
				id,
				name: properties.title.title[0].plain_text,
				...version === 2 ? { url } : {},
			});
		} else if (object === 'page' && parent.type === 'database_id') {
			results.push({
				id,
				...(version === 2) ? { name: getPropertyTitle(properties) } : {},
				...(version === 2) ? { url } : {},
				...(version === 2) ? { ...prepend('property', simplifyProperties(properties)) } : { ...simplifyProperties(properties) },
			});
		} else if (download && json.object === 'page' && json.parent.type === 'database_id') {
			results.push({
				json: {
					id,
					...(version === 2) ? { name: getPropertyTitle(json.properties) } : {},
					...(version === 2) ? { url } : {},
					...(version === 2) ? { ...prepend('property', simplifyProperties(json.properties)) } : { ...simplifyProperties(json.properties) },
				},
				binary,
			});
		} else if (object === 'database') {
			results.push({
				id,
				...version === 2 ? { name: title[0]?.plain_text || '' } : { title: title[0]?.plain_text || '' },
				...version === 2 ? { url } : {},
			});
		}
	}
	return results;
}

export function getFormattedChildren(children: IDataObject[]) {
	const results: IDataObject[] = [];
	for (const child of children) {
		const type = child.type;
		results.push({ [`${type}`]: child, object: 'block', type });
	}
	return results;
}

export function getConditions() {

	const elements: INodeProperties[] = [];

	const types: { [key: string]: string } = {
		title: 'rich_text',
		rich_text: 'rich_text',
		number: 'number',
		checkbox: 'checkbox',
		select: 'select',
		multi_select: 'multi_select',
		date: 'date',
		people: 'people',
		files: 'files',
		url: 'rich_text',
		email: 'rich_text',
		phone_number: 'rich_text',
		relation: 'relation',
		//formula: 'formula',
		created_by: 'people',
		created_time: 'date',
		last_edited_by: 'people',
		last_edited_time: 'date',
	};

	const typeConditions: { [key: string]: string[] } = {
		rich_text: [
			'equals',
			'does_not_equal',
			'contains',
			'does_not_contain',
			'starts_with',
			'ends_with',
			'is_empty',
			'is_not_empty',
		],
		number: [
			'equals',
			'does_not_equal',
			'grater_than',
			'less_than',
			'greater_than_or_equal_to',
			'less_than_or_equal_to',
			'is_empty',
			'is_not_empty',
		],
		checkbox: [
			'equals',
			'does_not_equal',
		],
		select: [
			'equals',
			'does_not_equal',
			'is_empty',
			'is_not_empty',
		],
		multi_select: [
			'contains',
			'does_not_equal',
			'is_empty',
			'is_not_empty',
		],
		date: [
			'equals',
			'before',
			'after',
			'on_or_before',
			'is_empty',
			'is_not_empty',
			'on_or_after',
			'past_week',
			'past_month',
			'past_year',
			'next_week',
			'next_month',
			'next_year',
		],
		people: [
			'contains',
			'does_not_contain',
			'is_empty',
			'is_not_empty',
		],
		files: [
			'is_empty',
			'is_not_empty',
		],
		relation: [
			'contains',
			'does_not_contain',
			'is_empty',
			'is_not_empty',
		],
	};

	const formula: { [key: string]: string[] } = {
		text: [
			...typeConditions.rich_text,
		],
		checkbox: [
			...typeConditions.checkbox,
		],
		number: [
			...typeConditions.number,
		],
		date: [
			...typeConditions.date,
		],
	};

	for (const type of Object.keys(types)) {
		elements.push(
			{
				displayName: 'Condition',
				name: 'condition',
				type: 'options',
				displayOptions: {
					show: {
						type: [
							type,
						],
					},
				} as IDisplayOptions,
				options: (typeConditions[types[type]] as string[]).map((type: string) => ({ name: capitalCase(type), value: type })),
				default: '',
				description: 'The value of the property to filter by.',
			} as INodeProperties,
		);
	}

	elements.push(
		{
			displayName: 'Return Type',
			name: 'returnType',
			type: 'options',
			displayOptions: {
				show: {
					type: [
						'formula',
					],
				},
			} as IDisplayOptions,
			options: Object.keys(formula).map((key: string) => ({ name: capitalCase(key), value: key })),
			default: '',
			description: 'The formula return type',
		} as INodeProperties,
	);

	for (const key of Object.keys(formula)) {
		elements.push(
			{
				displayName: 'Condition',
				name: 'condition',
				type: 'options',
				displayOptions: {
					show: {
						type: [
							'formula',
						],
						returnType: [
							key,
						],
					},
				} as IDisplayOptions,
				options: formula[key].map((key: string) => ({ name: capitalCase(key), value: key })),
				default: '',
				description: 'The value of the property to filter by.',
			} as INodeProperties,
		);
	}

	return elements;
}

export function validateCrendetials(this: ICredentialTestFunctions, credentials: ICredentialDataDecryptedObject) {
	const options: OptionsWithUri = {
		headers: {
			'Authorization': `Bearer ${credentials.apiKey}`,
			'Notion-Version': apiVersion[2],
		},
		method: 'GET',
		uri: `https://api.notion.com/v1/users/me`,
		json: true,
	};
	return this.helpers.request!(options);
}

// tslint:disable-next-line: no-any
export async function downloadFiles(this: IExecuteFunctions | IPollFunctions, records: [{ properties: { [key: string]: any | { id: string, type: string, files: [{ external: { url: string } } | { file: { url: string } }] } } }]): Promise<INodeExecutionData[]> {
	const elements: INodeExecutionData[] = [];
	for (const record of records) {
		const element: INodeExecutionData = { json: {}, binary: {} };
		element.json = record as unknown as IDataObject;
		for (const key of Object.keys(record.properties)) {
			if (record.properties[key].type === 'files') {
				if (record.properties[key].files.length) {
					for (const [index, file] of record.properties[key].files.entries()) {
						const data = await notionApiRequest.call(this, 'GET', '', {}, {}, file?.file?.url || file?.external?.url, { json: false, encoding: null });
						element.binary![`${key}_${index}`] = await this.helpers.prepareBinaryData(data);
					}
				}
			}
		}
		if (Object.keys(element.binary as IBinaryKeyData).length === 0) {
			delete element.binary;
		}
		elements.push(element);
	}
	return elements;
}

export function extractPageId(page: string) {
	if (page.includes('p=')) {
		return page.split('p=')[1];
	} else if (page.includes('-') && page.includes('https')) {
		return page.split('-')[page.split('-').length - 1];
	}
	return page;
}

export function extractDatabaseId(database: string) {
	if (database.includes('?v=')) {
		const data = database.split('?v=')[0].split('/');
		const index = data.length - 1;
		return data[index];
	} else if (database.includes('/')) {
		const index = database.split('/').length - 1;
		return database.split('/')[index];
	} else {
		return database;
	}
}

// tslint:disable-next-line: no-any
function prepend(stringKey: string, properties: { [key: string]: any }) {
	for (const key of Object.keys(properties)) {
		properties[`${stringKey}_${snakeCase(key)}`] = properties[key];
		delete properties[key];
	}
	return properties;
}

// tslint:disable-next-line: no-any
export function getPropertyTitle(properties: { [key: string]: any }) {
	return Object.values(properties).filter(property => property.type === 'title')[0].title[0]?.plain_text || '';
}

export function getSearchFilters(resource: string) {
	return [
		{
			displayName: 'Filter',
			name: 'filterType',
			type: 'options',
			options: [
				{
					name: 'None',
					value: 'none',
				},
				{
					name: 'Build Manually',
					value: 'manual',
				},
				{
					name: 'JSON',
					value: 'json',
				},
			],
			displayOptions: {
				show: {
					version: [
						2,
					],
					resource: [
						resource,
					],
					operation: [
						'getAll',
					],
				},
			},
			default: 'none',
		},
		{
			displayName: 'Must Match',
			name: 'matchType',
			type: 'options',
			options: [
				{
					name: 'Any filter',
					value: 'anyFilter',
				},
				{
					name: 'All Filters',
					value: 'allFilters',
				},
			],
			displayOptions: {
				show: {
					version: [
						2,
					],
					resource: [
						resource,
					],
					operation: [
						'getAll',
					],
					filterType: [
						'manual',
					],
				},
			},
			default: 'anyFilter',
		},
		{
			displayName: 'Filters',
			name: 'filters',
			type: 'fixedCollection',
			typeOptions: {
				multipleValues: true,
			},
			displayOptions: {
				show: {
					version: [
						2,
					],
					resource: [
						resource,
					],
					operation: [
						'getAll',
					],
					filterType: [
						'manual',
					],
				},
			},
			default: '',
			placeholder: 'Add Condition',
			options: [
				{
					displayName: 'Conditions',
					name: 'conditions',
					values: [
						...filters(getConditions()),
					],
				},
			],
		},
		{
			displayName: 'See <a href="https://developers.notion.com/reference/post-database-query#post-database-query-filter" target="_blank">Notion guide</a> to creating filters',
			name: 'jsonNotice',
			type: 'notice',
			displayOptions: {
				show: {
					version: [
						2,
					],
					resource: [
						resource,
					],
					operation: [
						'getAll',
					],
					filterType: [
						'json',
					],
				},
			},
			default: '',
		},
		{
			displayName: 'Filters (JSON)',
			name: 'filterJson',
			type: 'string',
			typeOptions: {
				alwaysOpenEditWindow: true,
			},
			displayOptions: {
				show: {
					version: [
						2,
					],
					resource: [
						resource,
					],
					operation: [
						'getAll',
					],
					filterType: [
						'json',
					],
				},
			},
			default: '',
			description: '',
		},
	];
}

export function validateJSON(json: string | undefined): any { // tslint:disable-line:no-any
	let result;
	try {
		result = JSON.parse(json!);
	} catch (exception) {
		result = undefined;
	}
	return result;
}